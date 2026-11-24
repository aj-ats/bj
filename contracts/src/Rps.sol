// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Commit-reveal rock-paper-scissors. Stakes sit here until `claim`. See docs/rps/README.md.
contract Rps {
    uint8 public constant ROCK = 1;
    uint8 public constant PAPER = 2;
    uint8 public constant SCISSORS = 3;

    uint256 public constant MIN_STAKE = 1_000_000;
    uint256 public constant FEE_DENOM = 1000;
    uint256 public constant JOIN_WINDOW = 10 minutes;
    uint256 public constant REVEAL_WINDOW = 10 minutes;

    uint8 public constant REASON_DECISION = 1;
    uint8 public constant REASON_TIE = 2;
    uint8 public constant REASON_FORFEIT = 3;
    uint8 public constant REASON_REFUND = 4;

    enum Status {
        None,
        Waiting,
        Reveal,
        Settled,
        Cancelled
    }

    struct Match {
        address p1;
        address p2;
        uint256 stake;
        bytes32 commit1;
        bytes32 commit2;
        uint8 choice1;
        uint8 choice2;
        uint64 createdAt;
        uint64 revealDeadline;
        Status status;
    }

    IERC20 public immutable token;
    address public immutable feeRecipient;
    address public immutable owner;

    uint256 public nextMatchId = 1;
    bool public paused;
    mapping(uint256 => Match) public matches;
    mapping(address => uint256) public claimable;

    event Created(uint256 indexed matchId, address indexed p1, uint256 stake, bytes32 commit);
    event Joined(
        uint256 indexed matchId, address indexed p2, bytes32 commit, uint64 revealDeadline
    );
    event Cancelled(uint256 indexed matchId, address indexed p1, uint256 stake);
    event Revealed(uint256 indexed matchId, address indexed player, uint8 choice);
    event Settled(
        uint256 indexed matchId, address winner, uint256 payout, uint256 fee, uint8 reason
    );
    event Claimed(address indexed player, uint256 amount);
    event Paused(address indexed account);
    event Unpaused(address indexed account);

    error ZeroAddress();
    error BadCommit();
    error BadStake();
    error BadStatus();
    error BadChoice();
    error BadReveal();
    error AlreadyRevealed();
    error SamePlayer();
    error NotPlayer();
    error NotOwner();
    error Expired();
    error TooEarly();
    error NothingToClaim();
    error TransferFailed();
    error GameIsPaused();
    error Reentrancy();

    uint256 private constant UNLOCKED = 1;
    uint256 private constant LOCKED = 2;
    uint256 private lock = UNLOCKED;

    modifier nonReentrant() {
        if (lock != UNLOCKED) revert Reentrancy();
        lock = LOCKED;
        _;
        lock = UNLOCKED;
    }

    constructor(address token_, address feeRecipient_, address owner_) {
        if (token_ == address(0) || feeRecipient_ == address(0) || owner_ == address(0)) {
            revert ZeroAddress();
        }
        token = IERC20(token_);
        feeRecipient = feeRecipient_;
        owner = owner_;
    }

    function commitHash(uint8 choice, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(choice, salt));
    }

    function beats(uint8 a, uint8 b) public pure returns (bool) {
        return
            (a == ROCK && b == SCISSORS) || (a == SCISSORS && b == PAPER)
                || (a == PAPER && b == ROCK);
    }

    function matchStatus(uint256 id) external view returns (uint8) {
        return uint8(matches[id].status);
    }

    function pause() external {
        if (msg.sender != owner) revert NotOwner();
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external {
        if (msg.sender != owner) revert NotOwner();
        paused = false;
        emit Unpaused(msg.sender);
    }

    function createMatch(bytes32 commit, uint256 stake) external nonReentrant returns (uint256 id) {
        if (paused) revert GameIsPaused();
        if (commit == bytes32(0)) revert BadCommit();
        if (stake < MIN_STAKE || stake > type(uint256).max / 2) revert BadStake();

        id = nextMatchId++;
        _pull(msg.sender, stake);
        matches[id] = Match({
            p1: msg.sender,
            p2: address(0),
            stake: stake,
            commit1: commit,
            commit2: bytes32(0),
            choice1: 0,
            choice2: 0,
            createdAt: uint64(block.timestamp),
            revealDeadline: 0,
            status: Status.Waiting
        });
        emit Created(id, msg.sender, stake, commit);
    }

    function joinMatch(uint256 id, bytes32 commit) external nonReentrant {
        if (paused) revert GameIsPaused();
        Match storage m = matches[id];
        if (m.status != Status.Waiting) revert BadStatus();
        if (block.timestamp > m.createdAt + JOIN_WINDOW) revert Expired();
        if (msg.sender == m.p1) revert SamePlayer();
        if (commit == bytes32(0)) revert BadCommit();

        _pull(msg.sender, m.stake);
        m.p2 = msg.sender;
        m.commit2 = commit;
        m.revealDeadline = uint64(block.timestamp + REVEAL_WINDOW);
        m.status = Status.Reveal;
        emit Joined(id, msg.sender, commit, m.revealDeadline);
    }

    /// @dev The creator can cancel a lobby immediately. Anyone can cancel it after the join window.
    function cancel(uint256 id) external nonReentrant {
        Match storage m = matches[id];
        if (m.status != Status.Waiting) revert BadStatus();
        bool creator = msg.sender == m.p1;
        bool expired = block.timestamp > m.createdAt + JOIN_WINDOW;
        if (!creator && !expired) revert NotPlayer();

        uint256 stake = m.stake;
        address p1 = m.p1;
        m.status = Status.Cancelled;
        claimable[p1] += stake;
        emit Cancelled(id, p1, stake);
    }

    function reveal(uint256 id, uint8 choice, bytes32 salt) external nonReentrant {
        Match storage m = matches[id];
        if (m.status != Status.Reveal) revert BadStatus();
        if (choice < ROCK || choice > SCISSORS) revert BadChoice();

        bytes32 got = commitHash(choice, salt);
        if (msg.sender == m.p1) {
            if (m.choice1 != 0) revert AlreadyRevealed();
            if (got != m.commit1) revert BadReveal();
            m.choice1 = choice;
        } else if (msg.sender == m.p2) {
            if (m.choice2 != 0) revert AlreadyRevealed();
            if (got != m.commit2) revert BadReveal();
            m.choice2 = choice;
        } else {
            revert NotPlayer();
        }
        emit Revealed(id, msg.sender, choice);
    }

    function settle(uint256 id) external nonReentrant {
        Match storage m = matches[id];
        if (m.status != Status.Reveal) revert BadStatus();
        if (m.choice1 == 0 || m.choice2 == 0) revert BadStatus();
        _finish(m, id, false);
    }

    function timeout(uint256 id) external nonReentrant {
        Match storage m = matches[id];
        if (m.status != Status.Reveal) revert BadStatus();
        if (block.timestamp <= m.revealDeadline) revert TooEarly();

        bool revealed1 = m.choice1 != 0;
        bool revealed2 = m.choice2 != 0;
        if (!revealed1 && !revealed2) {
            m.status = Status.Settled;
            claimable[m.p1] += m.stake;
            claimable[m.p2] += m.stake;
            emit Settled(id, address(0), 0, 0, REASON_REFUND);
            return;
        }
        _finish(m, id, !(revealed1 && revealed2));
    }

    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        _push(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    /// @param forfeit True when exactly one seat revealed before the deadline.
    function _finish(Match storage m, uint256 id, bool forfeit) internal {
        m.status = Status.Settled;
        uint256 pot = m.stake * 2;

        if (!forfeit && m.choice1 == m.choice2) {
            claimable[m.p1] += m.stake;
            claimable[m.p2] += m.stake;
            emit Settled(id, address(0), 0, 0, REASON_TIE);
            return;
        }

        address winner =
            forfeit ? (m.choice1 != 0 ? m.p1 : m.p2) : (beats(m.choice1, m.choice2) ? m.p1 : m.p2);
        uint256 fee = pot / FEE_DENOM;
        uint8 reason = forfeit ? REASON_FORFEIT : REASON_DECISION;
        claimable[feeRecipient] += fee;
        claimable[winner] += pot - fee;
        emit Settled(id, winner, pot - fee, fee, reason);
    }

    function _pull(address from, uint256 amount) internal {
        _call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, address(this), amount));
    }

    function _push(address to, uint256 amount) internal {
        _call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
    }

    function _call(bytes memory data) internal {
        (bool ok, bytes memory ret) = address(token).call(data);
        if (!ok) {
            if (ret.length == 0) revert TransferFailed();
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        if (ret.length == 0) return;
        if (ret.length != 32 || !abi.decode(ret, (bool))) revert TransferFailed();
    }
}
