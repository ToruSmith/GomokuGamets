// worker.js — 五子棋 AI Web Worker（獨立執行緒，不阻塞 UI）
'use strict';

const SIZE = 15;

function checkWin(board, row, col, player) {
    const dirs = [[0,1],[1,0],[1,1],[1,-1]];
    for (const [dr, dc] of dirs) {
        let count = 1;
        for (let i = 1; i < 5; i++) {
            const r = row + dr*i, c = col + dc*i;
            if (r < 0 || r >= SIZE || c < 0 || c >= SIZE || board[r][c] !== player) break;
            count++;
        }
        for (let i = 1; i < 5; i++) {
            const r = row - dr*i, c = col - dc*i;
            if (r < 0 || r >= SIZE || c < 0 || c >= SIZE || board[r][c] !== player) break;
            count++;
        }
        if (count >= 5) return true;
    }
    return false;
}

function evalLine(board, row, col, dr, dc, player) {
    let count = 1, openEnds = 0;
    let r = row + dr, c = col + dc;
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r][c] === player) { count++; r += dr; c += dc; }
    if (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r][c] === null) openEnds++;
    r = row - dr; c = col - dc;
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r][c] === player) { count++; r -= dr; c -= dc; }
    if (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r][c] === null) openEnds++;
    if (count >= 5) return 100000;
    if (count === 4) return openEnds === 2 ? 10000 : openEnds === 1 ? 1000 : 0;
    if (count === 3) return openEnds === 2 ? 1000  : openEnds === 1 ? 100  : 0;
    if (count === 2) return openEnds === 2 ? 100   : openEnds === 1 ? 10   : 0;
    return 1;
}

function evalPos(board, row, col, aiPlayer) {
    const opp = aiPlayer === 'black' ? 'white' : 'black';
    const dirs = [[0,1],[1,0],[1,1],[1,-1]];
    let score = 0;
    for (const [dr, dc] of dirs) {
        score += evalLine(board, row, col, dr, dc, aiPlayer);
        score += evalLine(board, row, col, dr, dc, opp) * 0.9;
    }
    return score;
}

function getCandidates(board) {
    const seen = new Set();
    const result = [];
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (!board[r][c]) continue;
            for (let dr = -2; dr <= 2; dr++) {
                for (let dc = -2; dc <= 2; dc++) {
                    const nr = r + dr, nc = c + dc;
                    const key = `${nr},${nc}`;
                    if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && !board[nr][nc] && !seen.has(key)) {
                        seen.add(key);
                        result.push({ row: nr, col: nc });
                    }
                }
            }
        }
    }
    if (!result.length) result.push({ row: 7, col: 7 });
    return result;
}

function alphaBeta(board, row, col, player, aiPlayer, depth, alpha, beta, isMax) {
    board[row][col] = player;
    if (checkWin(board, row, col, player)) {
        board[row][col] = null;
        return isMax ? 100000 + depth * 1000 : -(100000 + depth * 1000);
    }
    if (depth === 0) {
        const score = evalPos(board, row, col, aiPlayer);
        board[row][col] = null;
        return isMax ? score : -score;
    }
    const next = player === 'black' ? 'white' : 'black';
    const cands = getCandidates(board);
    board[row][col] = null;

    if (isMax) {
        let best = -Infinity;
        for (const m of cands) {
            const s = alphaBeta(board, m.row, m.col, next, aiPlayer, depth - 1, alpha, beta, false);
            if (s > best) best = s;
            if (s > alpha) alpha = s;
            if (beta <= alpha) break;
        }
        return best;
    } else {
        let best = Infinity;
        for (const m of cands) {
            const s = alphaBeta(board, m.row, m.col, next, aiPlayer, depth - 1, alpha, beta, true);
            if (s < best) best = s;
            if (s < beta) beta = s;
            if (beta <= alpha) break;
        }
        return best;
    }
}

function getBestMove(board, aiPlayer, difficulty) {
    const depth = difficulty === 'easy' ? 1 : difficulty === 'medium' ? 2 : 3;
    const opp = aiPlayer === 'black' ? 'white' : 'black';
    const hasAny = board.some(row => row.some(c => c !== null));
    if (!hasAny) return { row: 7, col: 7 };

    const cands = getCandidates(board);

    // Quick score + immediate win/block detection
    const scored = cands.map(m => {
        board[m.row][m.col] = aiPlayer;
        if (checkWin(board, m.row, m.col, aiPlayer)) { board[m.row][m.col] = null; return { ...m, score: Infinity }; }
        board[m.row][m.col] = null;
        board[m.row][m.col] = opp;
        if (checkWin(board, m.row, m.col, opp)) { board[m.row][m.col] = null; return { ...m, score: 99999 }; }
        board[m.row][m.col] = null;
        return { ...m, score: evalPos(board, m.row, m.col, aiPlayer) };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, difficulty === 'hard' ? 12 : 7);

    let bestMove = top[0], bestScore = -Infinity;
    for (const m of top) {
        if (m.score === Infinity || m.score === 99999) return m;
        const s = alphaBeta(board, m.row, m.col, aiPlayer, aiPlayer, depth, -Infinity, Infinity, true);
        if (s > bestScore) { bestScore = s; bestMove = m; }
    }
    return bestMove;
}

self.onmessage = (e) => {
    const { board, aiPlayer, difficulty } = e.data;
    const copy = board.map(r => [...r]);
    const move = getBestMove(copy, aiPlayer, difficulty);
    self.postMessage(move);
};
