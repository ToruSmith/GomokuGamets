// script.js — 五子棋主程式 (ES Module)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getDatabase, ref, set, get, update, onValue, off, serverTimestamp }
    from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

// ═══════════════════════════════════════════════
//  工具：產生隨機房間代碼
// ═══════════════════════════════════════════════
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ═══════════════════════════════════════════════
//  主類別
// ═══════════════════════════════════════════════
class GomokuGame {
    constructor() {
        this.boardSize   = 15;
        this.board       = [];
        this.currentPlayer = 'black';
        this.gameOver    = false;
        this.moveHistory = [];
        this.aiEnabled   = false;
        this.aiPlayer    = 'white';
        this.aiDifficulty = 'medium';
        this.soundEnabled = true;
        this.aiThinking  = false;
        this.gameStartTime = null;
        this.stats = { blackWins: 0, whiteWins: 0 };

        // 線上對戰狀態
        this.onlineMode  = false;
        this.roomId      = null;
        this.myColor     = null;
        this.roomListener = null;
        this.db          = null;
        this.auth        = null;
        this.uid         = null;
        this.firebaseReady = false;
        this.lastSyncedMoveCount = 0;

        // AI Web Worker
        this.aiWorker = null;

        // 複用 AudioContext（避免每次落子都建新的）
        this.audioCtx = null;

        // DOM
        this.boardEl         = document.getElementById('board');
        this.resetBtn        = document.getElementById('reset-btn');
        this.undoBtn         = document.getElementById('undo-btn');
        this.aiBtn           = document.getElementById('ai-btn');
        this.onlineBtn       = document.getElementById('online-btn');
        this.moveCountEl     = document.getElementById('move-count');
        this.aiStatusEl      = document.getElementById('ai-status');
        this.modal           = document.getElementById('game-over-modal');
        this.modalMsg        = document.getElementById('modal-message');
        this.playAgainBtn    = document.getElementById('play-again-btn');
        this.closeModalBtn   = document.getElementById('close-modal-btn');
        this.themeToggle     = document.getElementById('theme-toggle');
        this.soundToggle     = document.getElementById('sound-toggle');
        this.aiDiffSelect    = document.getElementById('ai-difficulty');
        this.blackWinsEl     = document.getElementById('black-wins');
        this.whiteWinsEl     = document.getElementById('white-wins');
        this.playerBlackCard = document.getElementById('player-black');
        this.playerWhiteCard = document.getElementById('player-white');
        this.blackStatusEl   = document.getElementById('black-status');
        this.whiteStatusEl   = document.getElementById('white-status');
        this.onlineStatusEl  = document.getElementById('online-status');
        this.onlineStatusText= document.getElementById('online-status-text');
        this.roomCodeBadge   = document.getElementById('room-code-badge');
        this.leaveRoomBtn    = document.getElementById('leave-room-btn');

        // Lobby
        this.lobbyModal      = document.getElementById('online-lobby-modal');
        this.createRoomBtn   = document.getElementById('create-room-btn');
        this.joinRoomBtn     = document.getElementById('join-room-btn');
        this.roomCodeInput   = document.getElementById('room-code-input');
        this.lobbyHome       = document.getElementById('lobby-home');
        this.lobbyWaiting    = document.getElementById('lobby-waiting');
        this.lobbyJoined     = document.getElementById('lobby-joined');
        this.displayRoomCode = document.getElementById('display-room-code');
        this.copyCodeBtn     = document.getElementById('copy-code-btn');
        this.closeLobbyBtn   = document.getElementById('close-lobby-btn');
        this.lobbyError      = document.getElementById('lobby-error');

        this.initFirebase();
        this.initWorker();
        this.bindEvents();
        this.resetGame();
        requestAnimationFrame(() => this.initBoard());
    }

    // ─────────── Firebase ───────────
    initFirebase() {
        if (firebaseConfig.apiKey === 'YOUR_API_KEY') {
            console.warn('Firebase 尚未設定，線上對戰功能不可用。');
            return;
        }
        try {
            const app = initializeApp(firebaseConfig);
            this.db   = getDatabase(app);
            this.auth = getAuth(app);
            signInAnonymously(this.auth)
                .then(cred => {
                    this.uid = cred.user.uid;
                    this.firebaseReady = true;
                    console.log('Firebase 匿名登入成功，UID:', this.uid);
                })
                .catch(err => {
                    console.warn('Firebase 匿名登入失敗（請確認已在 Console 啟用）:', err.message);
                });
        } catch (e) {
            console.warn('Firebase 初始化失敗:', e.message);
        }
    }

    // ─────────── Web Worker ───────────
    initWorker() {
        try {
            this.aiWorker = new Worker('worker.js');
            this.aiWorker.onmessage = (e) => this.onWorkerResult(e.data);
            this.aiWorker.onerror   = (e) => {
                console.warn('Worker 錯誤，改用內建 AI:', e.message);
                this.aiWorker = null;
            };
        } catch (e) {
            console.warn('Web Worker 不支援，使用內建 AI');
        }
    }

    onWorkerResult(move) {
        if (!move || this.gameOver) {
            this.hideAiThinking(); this.aiThinking = false; return;
        }
        this.doAiMove(move.row, move.col);
    }

    // ─────────── 棋盤初始化 ───────────
    get cellSize() {
        const w = this.boardEl.clientWidth;
        return (w - 40) / (this.boardSize - 1);
    }

    initBoard() {
        // 移除舊星位
        this.boardEl.querySelectorAll('.star-point').forEach(e => e.remove());
        // 更新格線 CSS 變數
        this.boardEl.style.setProperty('--cell-size', this.cellSize + 'px');

        const stars = [[3,3],[3,11],[11,3],[11,11],[7,7],[3,7],[7,3],[7,11],[11,7]];
        stars.forEach(([r, c]) => {
            const el = document.createElement('div');
            el.className = 'star-point';
            el.style.left = `${c * this.cellSize + 20}px`;
            el.style.top  = `${r * this.cellSize + 20}px`;
            this.boardEl.appendChild(el);
        });
    }

    repositionAll() {
        const cs = this.cellSize;
        this.boardEl.style.setProperty('--cell-size', cs + 'px');
        this.boardEl.querySelectorAll('.star-point').forEach(el => {
            el.style.display = 'none';
        });
        this.initBoard();
        this.boardEl.querySelectorAll('.piece').forEach(el => {
            const r = +el.dataset.row, c = +el.dataset.col;
            el.style.left = `${c * cs + 20}px`;
            el.style.top  = `${r * cs + 20}px`;
        });
    }

    pixelToGrid(x, y) {
        const cs = this.cellSize;
        return {
            row: Math.round((y - 20) / cs),
            col: Math.round((x - 20) / cs),
        };
    }

    // ─────────── 事件綁定 ───────────
    bindEvents() {
        this.boardEl.addEventListener('click',     (e) => this.handleClick(e));
        this.boardEl.addEventListener('mousemove', (e) => this.handleHover(e));
        this.boardEl.addEventListener('mouseleave',()  => this.removeHover());

        // ── 觸控支援（手機 / 平板）──
        this.boardEl.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const t = e.changedTouches[0];
            this.handleClick({ clientX: t.clientX, clientY: t.clientY });
        }, { passive: false });
        this.boardEl.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const t = e.changedTouches[0];
            this.handleHover({ clientX: t.clientX, clientY: t.clientY });
        }, { passive: false });
        this.boardEl.addEventListener('touchend', () => this.removeHover());

        this.resetBtn?.addEventListener('click', () => {
            if (this.moveHistory.length === 0 || confirm('確定要重新開始嗎？')) this.resetGame();
        });
        this.undoBtn?.addEventListener('click', () => this.undo());
        this.aiBtn?.addEventListener('click', () => this.toggleAI());
        this.onlineBtn?.addEventListener('click', () => this.openLobby());

        this.playAgainBtn?.addEventListener('click',  () => { this.resetGame(); this.closeModal(); });
        this.closeModalBtn?.addEventListener('click', () => this.closeModal());
        this.themeToggle?.addEventListener('click',   () => this.toggleTheme());
        this.soundToggle?.addEventListener('click',   () => this.toggleSound());
        this.aiDiffSelect?.addEventListener('change', (e) => { this.aiDifficulty = e.target.value; });

        // Segmented difficulty control (replaces <select>)
        const diffPanel = document.getElementById('ai-difficulty');
        diffPanel?.querySelectorAll('.diff-seg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                diffPanel.querySelectorAll('.diff-seg-btn').forEach(b => b.classList.remove('is-active'));
                btn.classList.add('is-active');
                this.aiDifficulty = btn.dataset.value;
            });
        });

        // Lobby
        this.createRoomBtn?.addEventListener('click', () => this.createRoom());
        this.joinRoomBtn?.addEventListener('click', () => {
            const code = this.roomCodeInput?.value.trim().toUpperCase();
            if (code?.length === 6) this.joinRoom(code);
            else this.showLobbyError('請輸入 6 位房間代碼');
        });
        this.roomCodeInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.joinRoomBtn?.click();
        });
        this.copyCodeBtn?.addEventListener('click', () => this.copyRoomCode());
        this.closeLobbyBtn?.addEventListener('click', () => this.closeLobbyModal());
        this.leaveRoomBtn?.addEventListener('click', () => this.leaveRoom());

        // 響應式：視窗縮放時更新棋盤
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => this.repositionAll(), 200);
        });
    }

    // ─────────── 重置 ───────────
    resetGame() {
        this.board = Array(this.boardSize).fill(null).map(() => Array(this.boardSize).fill(null));
        this.currentPlayer = 'black';
        this.gameOver = false;
        this.moveHistory = [];
        this.aiThinking  = false;
        this.lastSyncedMoveCount = 0;
        this.gameStartTime = Date.now();

        this.boardEl.querySelectorAll('.piece, .win-line').forEach(el => el.remove());
        this.modal && (this.modal.style.display = 'none');

        // 如果在線上模式，不重置 AI 按鈕
        if (!this.onlineMode) {
            this.aiEnabled = false;
            if (this.aiBtn) {
                const icon = this.aiBtn.querySelector('.btn-icon');
                const text = this.aiBtn.querySelector('.btn-text');
                if (icon) icon.textContent = '🤖';
                if (text) text.textContent = 'AI 對戰';
                this.aiBtn.style.background = '';
                this.aiBtn.disabled = false;
            }
        }

        this.updateUI();
        this.updateStats();
    }

    // ─────────── 點擊落子 ───────────
    handleClick(e) {
        if (this.gameOver || this.aiThinking) return;

        // 線上模式：只能在自己的回合出棋
        if (this.onlineMode) {
            if (this.currentPlayer !== this.myColor) return;
            const rect = this.boardEl.getBoundingClientRect();
            const { row, col } = this.pixelToGrid(e.clientX - rect.left, e.clientY - rect.top);
            if (!this.isValid(row, col)) return;
            this.removeHover();
            this.sendMoveOnline(row, col);
            return;
        }

        // AI 模式：等待 AI 時不回應
        if (this.aiEnabled && this.currentPlayer === this.aiPlayer) return;

        const rect = this.boardEl.getBoundingClientRect();
        const { row, col } = this.pixelToGrid(e.clientX - rect.left, e.clientY - rect.top);
        if (!this.isValid(row, col)) return;

        this.removeHover();
        this.placePiece(row, col);
        this.playSound();

        const winLine = this.checkWin(row, col);
        if (winLine) { this.gameOver = true; this.highlightWin(winLine); setTimeout(() => this.showWinner(), 400); return; }
        if (this.isFull()) { this.gameOver = true; setTimeout(() => this.showDraw(), 400); return; }

        this.currentPlayer = this.currentPlayer === 'black' ? 'white' : 'black';
        this.updateUI();

        if (this.aiEnabled && this.currentPlayer === this.aiPlayer) {
            this.aiThinking = true;
            this.showAiThinking();
            this.runAI();
        }
    }

    handleHover(e) {
        if (this.gameOver || this.aiThinking) return;
        if (this.aiEnabled && this.currentPlayer === this.aiPlayer) return;
        if (this.onlineMode && this.currentPlayer !== this.myColor) return;

        const rect = this.boardEl.getBoundingClientRect();
        const { row, col } = this.pixelToGrid(e.clientX - rect.left, e.clientY - rect.top);
        this.isValid(row, col) ? this.showHover(row, col) : this.removeHover();
    }

    isValid(row, col) {
        return row >= 0 && row < this.boardSize && col >= 0 && col < this.boardSize && this.board[row][col] === null;
    }

    // ─────────── 落子 ───────────
    placePiece(row, col) {
        this.board[row][col] = this.currentPlayer;
        this.moveHistory.push({ row, col, player: this.currentPlayer });

        this.boardEl.querySelector('.piece.last-move')?.classList.remove('last-move');

        const piece = document.createElement('div');
        piece.className = `piece ${this.currentPlayer} last-move`;
        piece.dataset.row = row;
        piece.dataset.col = col;
        const cs = this.cellSize;
        piece.style.left = `${col * cs + 20}px`;
        piece.style.top  = `${row * cs + 20}px`;
        this.boardEl.appendChild(piece);

        if (this.moveCountEl) this.moveCountEl.textContent = this.moveHistory.length;
    }

    // ─────────── 懸停提示 ───────────
    showHover(row, col) {
        const ex = this.boardEl.querySelector('.hover-piece');
        if (ex && ex.dataset.row === String(row) && ex.dataset.col === String(col)) return;
        ex?.remove();
        const hp = document.createElement('div');
        hp.className = `piece ${this.currentPlayer} hover-piece`;
        hp.dataset.row = row; hp.dataset.col = col;
        const cs = this.cellSize;
        hp.style.left = `${col * cs + 20}px`;
        hp.style.top  = `${row * cs + 20}px`;
        hp.style.opacity = '0.4';
        hp.style.pointerEvents = 'none';
        this.boardEl.appendChild(hp);
    }
    removeHover() { this.boardEl.querySelector('.hover-piece')?.remove(); }

    // ─────────── 悔棋 ───────────
    undo() {
        if (!this.moveHistory.length || this.gameOver || this.aiThinking || this.onlineMode) return;
        const steps = this.aiEnabled ? 2 : 1;
        for (let i = 0; i < steps && this.moveHistory.length; i++) {
            const { row, col } = this.moveHistory.pop();
            this.board[row][col] = null;
            this.boardEl.querySelector(`.piece[data-row="${row}"][data-col="${col}"]`)?.remove();
        }
        const pieces = this.boardEl.querySelectorAll('.piece:not(.hover-piece)');
        pieces[pieces.length - 1]?.classList.add('last-move');
        this.currentPlayer = this.aiEnabled ? 'black' : (this.currentPlayer === 'black' ? 'white' : 'black');
        this.updateUI();
    }

    // ─────────── 勝負判定 ───────────
    checkWin(row, col) {
        const p = this.board[row][col];
        const dirs = [[0,1],[1,0],[1,1],[1,-1]];
        for (const [dr, dc] of dirs) {
            const line = [{ row, col }];
            let r = row + dr, c = col + dc;
            while (r >= 0 && r < this.boardSize && c >= 0 && c < this.boardSize && this.board[r][c] === p) {
                line.push({ row: r, col: c }); r += dr; c += dc;
            }
            r = row - dr; c = col - dc;
            while (r >= 0 && r < this.boardSize && c >= 0 && c < this.boardSize && this.board[r][c] === p) {
                line.push({ row: r, col: c }); r -= dr; c -= dc;
            }
            if (line.length >= 5) return line;
        }
        return null;
    }

    highlightWin(line) {
        line.forEach(({ row, col }) => {
            this.boardEl.querySelector(`.piece[data-row="${row}"][data-col="${col}"]`)?.classList.add('winning');
        });
    }

    isFull() { return this.board.every(row => row.every(c => c !== null)); }

    // ─────────── AI ───────────
    toggleAI() {
        if (this.onlineMode) return;
        this.aiEnabled = !this.aiEnabled;
        const icon = this.aiBtn?.querySelector('.btn-icon');
        const text = this.aiBtn?.querySelector('.btn-text');
        if (this.aiEnabled) {
            if (this.aiBtn) {
                this.aiBtn.disabled = true;
                this.aiBtn.style.background = 'linear-gradient(135deg,#27ae60,#2ecc71)';
                if (icon) icon.textContent = '🤖';
                if (text) text.textContent = 'AI 對戰中';
            }
            if (this.currentPlayer === this.aiPlayer && !this.gameOver) {
                this.aiThinking = true;
                this.showAiThinking();
                this.runAI();
            }
        } else {
            if (this.aiBtn) {
                this.aiBtn.disabled = false;
                this.aiBtn.style.background = '';
                if (icon) icon.textContent = '🤖';
                if (text) text.textContent = 'AI 對戰';
            }
        }
    }

    runAI() {
        if (this.aiWorker) {
            // 傳給 Web Worker（不阻塞 UI）
            this.aiWorker.postMessage({
                board: this.board.map(r => [...r]),
                aiPlayer: this.aiPlayer,
                difficulty: this.aiDifficulty,
            });
        } else {
            // 備用：內建 AI（同步，可能略慢）
            setTimeout(() => {
                const move = this.getInlineAIMove();
                if (move) this.doAiMove(move.row, move.col);
                else { this.hideAiThinking(); this.aiThinking = false; }
            }, 50);
        }
    }

    doAiMove(row, col) {
        this.hideAiThinking();
        this.aiThinking = false;
        if (this.gameOver) return;

        this.placePiece(row, col);
        this.playSound();

        const winLine = this.checkWin(row, col);
        if (winLine) { this.gameOver = true; this.highlightWin(winLine); setTimeout(() => this.showWinner(), 400); return; }
        if (this.isFull()) { this.gameOver = true; setTimeout(() => this.showDraw(), 400); return; }

        this.currentPlayer = 'black';
        this.updateUI();
    }

    // 備用內建 AI（簡易貪心）
    getInlineAIMove() {
        if (!this.moveHistory.length) return { row: 7, col: 7 };
        let best = -Infinity, move = null;
        const opp = this.aiPlayer === 'black' ? 'white' : 'black';
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (!this.isValid(r, c)) continue;
                this.board[r][c] = this.aiPlayer;
                if (this.checkWin(r, c)) { this.board[r][c] = null; return { row: r, col: c }; }
                this.board[r][c] = null;
                this.board[r][c] = opp;
                const block = this.checkWin(r, c) ? 50000 : 0;
                this.board[r][c] = null;
                const score = block + this.quickEval(r, c);
                if (score > best) { best = score; move = { row: r, col: c }; }
            }
        }
        return move;
    }

    quickEval(row, col) {
        let s = 0;
        const dirs = [[0,1],[1,0],[1,1],[1,-1]];
        for (const [dr, dc] of dirs) {
            s += this.evalLine(row, col, dr, dc, this.aiPlayer);
        }
        return s;
    }

    evalLine(row, col, dr, dc, player) {
        let count = 1, open = 0;
        let r = row+dr, c = col+dc;
        while (r>=0&&r<this.boardSize&&c>=0&&c<this.boardSize&&this.board[r][c]===player){count++;r+=dr;c+=dc;}
        if(r>=0&&r<this.boardSize&&c>=0&&c<this.boardSize&&this.board[r][c]===null) open++;
        r=row-dr; c=col-dc;
        while(r>=0&&r<this.boardSize&&c>=0&&c<this.boardSize&&this.board[r][c]===player){count++;r-=dr;c-=dc;}
        if(r>=0&&r<this.boardSize&&c>=0&&c<this.boardSize&&this.board[r][c]===null) open++;
        if(count>=5) return 100000;
        if(count===4) return open===2?10000:open===1?1000:0;
        if(count===3) return open===2?1000:open===1?100:0;
        if(count===2) return open===2?100:open===1?10:0;
        return 1;
    }

    // ═══════════════════════════════════════════════
    //  線上對戰
    // ═══════════════════════════════════════════════

    openLobby() {
        if (!this.firebaseReady) {
            alert('❌ Firebase 尚未設定或連線失敗。\n\n請參考 README.md 完成設定後再使用線上對戰。');
            return;
        }
        this.lobbyModal.style.display = 'flex';
        this.showLobbySection('home');
    }

    closeLobbyModal() {
        this.lobbyModal.style.display = 'none';
        this.showLobbySection('home');
        if (this.roomCodeInput) this.roomCodeInput.value = '';
        this.hideLobbyError();
    }

    showLobbySection(section) {
        this.lobbyHome?.classList.toggle('hidden', section !== 'home');
        this.lobbyWaiting?.classList.toggle('hidden', section !== 'waiting');
        this.lobbyJoined?.classList.toggle('hidden', section !== 'joined');
    }

    showLobbyError(msg) {
        if (this.lobbyError) { this.lobbyError.textContent = msg; this.lobbyError.classList.remove('hidden'); }
    }
    hideLobbyError() { this.lobbyError?.classList.add('hidden'); }

    async createRoom() {
        if (!this.firebaseReady) return;
        this.createRoomBtn.disabled = true;
        this.createRoomBtn.textContent = '建立中...';

        let code, tries = 0;
        // 確保代碼不重複
        while (tries < 5) {
            code = generateRoomCode();
            const snap = await get(ref(this.db, `rooms/${code}`));
            if (!snap.exists()) break;
            tries++;
        }

        const roomData = {
            status: 'waiting',
            players: { black: this.uid, white: null },
            board: Array(this.boardSize).fill(null).map(() => Array(this.boardSize).fill(null)),
            currentPlayer: 'black',
            lastMove: null,
            moveCount: 0,
            winner: null,
            createdAt: Date.now(),
        };

        await set(ref(this.db, `rooms/${code}`), roomData);

        this.roomId   = code;
        this.myColor  = 'black';
        this.onlineMode = true;

        if (this.displayRoomCode) this.displayRoomCode.textContent = code;
        this.showLobbySection('waiting');
        this.createRoomBtn.disabled = false;
        this.createRoomBtn.textContent = '🏠 建立新房間（執黑先手）';

        this.listenRoom(code);
    }

    async joinRoom(code) {
        if (!this.firebaseReady) return;
        this.hideLobbyError();
        this.joinRoomBtn.disabled = true;
        this.joinRoomBtn.textContent = '加入中...';

        const roomRef = ref(this.db, `rooms/${code}`);
        const snap = await get(roomRef);

        if (!snap.exists()) {
            this.showLobbyError('❌ 找不到此房間，請確認代碼正確。');
            this.joinRoomBtn.disabled = false;
            this.joinRoomBtn.textContent = '加入';
            return;
        }

        const data = snap.val();

        if (data.status !== 'waiting') {
            this.showLobbyError('❌ 此房間已開始或已結束，無法加入。');
            this.joinRoomBtn.disabled = false;
            this.joinRoomBtn.textContent = '加入';
            return;
        }

        if (data.players.black === this.uid) {
            this.showLobbyError('❌ 不能加入自己建立的房間，請讓別人加入。');
            this.joinRoomBtn.disabled = false;
            this.joinRoomBtn.textContent = '加入';
            return;
        }

        await update(roomRef, {
            'players/white': this.uid,
            status: 'playing',
        });

        this.roomId   = code;
        this.myColor  = 'white';
        this.onlineMode = true;
        this.showLobbySection('joined');
        this.joinRoomBtn.disabled = false;
        this.joinRoomBtn.textContent = '加入';

        this.listenRoom(code);
    }

    listenRoom(roomId) {
        const roomRef = ref(this.db, `rooms/${roomId}`);
        this.roomListener = onValue(roomRef, (snap) => {
            const data = snap.val();
            if (!data) return;
            this.syncFromFirebase(data);
        });
    }

    syncFromFirebase(data) {
        // 對手已加入 → 開始遊戲
        if (data.status === 'playing' && this.lobbyModal.style.display === 'flex') {
            this.closeLobbyModal();
            this.startOnlineGame();
        }

        // 同步新落子
        if (data.moveCount > this.lastSyncedMoveCount && data.lastMove) {
            const { row, col, player } = data.lastMove;
            this.lastSyncedMoveCount = data.moveCount;

            if (!this.board[row][col]) {
                this.currentPlayer = player;
                this.placePiece(row, col);
                this.playSound();

                const winLine = this.checkWin(row, col);
                if (winLine) {
                    this.gameOver = true;
                    this.highlightWin(winLine);
                    setTimeout(() => this.showWinner(), 400);
                    this.updateUI();
                    return;
                }
                if (this.isFull()) {
                    this.gameOver = true;
                    setTimeout(() => this.showDraw(), 400);
                    this.updateUI();
                    return;
                }
            }
        }

        this.currentPlayer = data.currentPlayer ?? 'black';
        this.updateUI();
    }

    sendMoveOnline(row, col) {
        if (!this.db || !this.roomId) return;
        const roomRef = ref(this.db, `rooms/${this.roomId}`);
        update(roomRef, {
            [`board/${row}/${col}`]: this.myColor,
            currentPlayer: this.myColor === 'black' ? 'white' : 'black',
            lastMove: { row, col, player: this.myColor },
            moveCount: this.moveHistory.length + 1,
        });
    }

    startOnlineGame() {
        this.resetGame();
        this.onlineMode = true;
        this.aiEnabled  = false;
        this.currentPlayer = 'black';

        if (this.aiBtn) this.aiBtn.disabled = true;
        if (this.undoBtn) this.undoBtn.disabled = true;
        if (this.onlineStatusEl) this.onlineStatusEl.classList.remove('hidden');
        if (this.roomCodeBadge) this.roomCodeBadge.textContent = this.roomId;

        const myColorText = this.myColor === 'black' ? '⚫ 黑棋' : '⚪ 白棋';
        if (this.onlineStatusText) this.onlineStatusText.textContent = `線上對戰 · 你是${myColorText}`;
        this.updateUI();
    }

    leaveRoom() {
        if (!confirm('確定要離開房間嗎？')) return;
        if (this.roomListener && this.roomId) {
            off(ref(this.db, `rooms/${this.roomId}`));
            this.roomListener = null;
        }
        this.onlineMode = false;
        this.roomId     = null;
        this.myColor    = null;
        this.lastSyncedMoveCount = 0;

        if (this.onlineStatusEl) this.onlineStatusEl.classList.add('hidden');
        if (this.aiBtn) this.aiBtn.disabled = false;
        if (this.undoBtn) this.undoBtn.disabled = false;
        this.resetGame();
    }

    copyRoomCode() {
        if (!this.roomId) return;
        navigator.clipboard.writeText(this.roomId)
            .then(() => {
                if (this.copyCodeBtn) {
                    this.copyCodeBtn.textContent = '✅ 已複製！';
                    setTimeout(() => { this.copyCodeBtn.textContent = '📋 複製代碼'; }, 2000);
                }
            })
            .catch(() => {
                prompt('複製以下代碼：', this.roomId);
            });
    }

    // ─────────── UI 更新 ───────────
    updateUI() {
        if (this.moveCountEl) this.moveCountEl.textContent = this.moveHistory.length;

        const blackTurn = this.currentPlayer === 'black' && !this.gameOver;
        const whiteTurn = this.currentPlayer === 'white' && !this.gameOver;

        this.playerBlackCard?.classList.toggle('active', blackTurn);
        this.playerWhiteCard?.classList.toggle('active', whiteTurn);

        // 線上模式：高亮自己的回合
        if (this.onlineMode) {
            this.playerBlackCard?.classList.toggle('my-turn', blackTurn && this.myColor === 'black');
            this.playerWhiteCard?.classList.toggle('my-turn', whiteTurn && this.myColor === 'white');
        }

        if (this.blackStatusEl) {
            this.blackStatusEl.textContent = blackTurn
                ? (this.onlineMode && this.myColor === 'black' ? '⚡ 輪到你' : '輪到你')
                : '等待中';
        }
        if (this.whiteStatusEl) {
            this.whiteStatusEl.textContent = whiteTurn
                ? (this.aiEnabled ? 'AI 思考中' : this.onlineMode && this.myColor === 'white' ? '⚡ 輪到你' : '輪到你')
                : '等待中';
        }

        if (this.undoBtn) {
            this.undoBtn.disabled = this.moveHistory.length === 0 || this.gameOver || this.aiThinking || this.onlineMode;
        }

        // ── Turn Banner（手機版棋盤上方提示）──
        const bannerEl = document.getElementById('turn-banner');
        const bannerTextEl = document.getElementById('turn-banner-text');
        if (bannerEl && bannerTextEl) {
            bannerEl.classList.remove('is-my-turn', 'is-ai-turn');
            if (this.gameOver) {
                bannerEl.style.display = 'none';
            } else {
                bannerEl.style.display = '';
                const icon = this.currentPlayer === 'black' ? '⚫' : '⚪';
                const name = this.currentPlayer === 'black' ? '黑棋' : '白棋';
                if (this.onlineMode) {
                    if (this.currentPlayer === this.myColor) {
                        bannerTextEl.textContent = `${icon} ${name}・輪到你了`;
                        bannerEl.classList.add('is-my-turn');
                    } else {
                        bannerTextEl.textContent = `${icon} ${name}・等待對方...`;
                    }
                } else if (this.aiEnabled && this.currentPlayer === this.aiPlayer) {
                    bannerTextEl.textContent = `${icon} AI 思考中...`;
                    bannerEl.classList.add('is-ai-turn');
                } else {
                    bannerTextEl.textContent = `${icon} ${name}・輪到你了`;
                    bannerEl.classList.add('is-my-turn');
                }
            }
        }
    }

    updateStats() {
        if (this.blackWinsEl) this.blackWinsEl.textContent = this.stats.blackWins;
        if (this.whiteWinsEl) this.whiteWinsEl.textContent = this.stats.whiteWins;
    }

    showAiThinking() { this.aiStatusEl?.classList.remove('hidden'); }
    hideAiThinking() { this.aiStatusEl?.classList.add('hidden'); }

    showWinner() {
        const winner = this.currentPlayer;
        const txt = winner === 'black' ? '⚫ 黑棋' : '⚪ 白棋';
        if (winner === 'black') this.stats.blackWins++;
        else this.stats.whiteWins++;
        this.updateStats();
        if (this.modal) {
            this.modalMsg.innerHTML = `
                <div class="winner-icon">🏆</div>
                <h2>${txt} 獲勝！</h2>
                <div class="winner-stats">
                    <div class="stat"><div class="stat-label">步數</div>
                        <div class="stat-value">${this.moveHistory.length}</div></div>
                    <div class="stat"><div class="stat-label">時間</div>
                        <div class="stat-value">${this.formatTime(Date.now() - this.gameStartTime)}</div></div>
                </div>`;
            this.modal.style.display = 'flex';
        }
    }

    showDraw() {
        if (this.modal) {
            this.modalMsg.innerHTML = `
                <div class="winner-icon">🤝</div><h2>平局！</h2>
                <div class="winner-stats">
                    <div class="stat"><div class="stat-label">步數</div>
                        <div class="stat-value">${this.moveHistory.length}</div></div>
                    <div class="stat"><div class="stat-label">時間</div>
                        <div class="stat-value">${this.formatTime(Date.now() - this.gameStartTime)}</div></div>
                </div>`;
            this.modal.style.display = 'flex';
        }
    }

    closeModal() { if (this.modal) this.modal.style.display = 'none'; }

    formatTime(ms) {
        const s = Math.floor(ms / 1000);
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    // ─────────── 音效 ───────────
    playSound() {
        if (!this.soundEnabled) return;
        try {
            if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            osc.connect(gain); gain.connect(this.audioCtx.destination);
            osc.frequency.setValueAtTime(880, this.audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(440, this.audioCtx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.15, this.audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.12);
            osc.start(this.audioCtx.currentTime);
            osc.stop(this.audioCtx.currentTime + 0.12);
        } catch (e) { /* 靜音環境不報錯 */ }
    }

    // ─────────── 主題 / 音效 ───────────
    toggleTheme() {
        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
        document.documentElement.setAttribute('data-theme', dark ? '' : 'dark');
        if (this.themeToggle) this.themeToggle.textContent = dark ? '🌙' : '☀️';
    }

    toggleSound() {
        this.soundEnabled = !this.soundEnabled;
        const icon = this.soundToggle?.querySelector('.btn-icon');
        if (icon) icon.textContent = this.soundEnabled ? '🔊' : '🔇';
    }
}

// ── 啟動 ──
document.addEventListener('DOMContentLoaded', () => new GomokuGame());
