//! The 37-hole French board as a bitboard.
//!
//! Cell `i = r * 7 + c` on a 7×7 grid; a cell is a hole when `|r-3| + |c-3| <= 4`.
//! A position is a `u64` with bit `i` set when hole `i` holds a marble.

pub type Pos = u64;

/// The centre hole, d4.
pub const CENTRE: u8 = 24;

const fn is_valid_rc(r: i32, c: i32) -> bool {
    r >= 0 && r < 7 && c >= 0 && c < 7 && (r - 3).abs() + (c - 3).abs() <= 4
}

const fn build_valid() -> u64 {
    let mut m = 0u64;
    let mut i = 0;
    while i < 49 {
        if is_valid_rc(i / 7, i % 7) {
            m |= 1 << i;
        }
        i += 1;
    }
    m
}

/// Cells from which a jump in direction (dr, dc) stays on the board.
const fn build_from(dr: i32, dc: i32) -> u64 {
    let mut m = 0u64;
    let mut i = 0;
    while i < 49 {
        let (r, c) = (i / 7, i % 7);
        if is_valid_rc(r, c) && is_valid_rc(r + dr, c + dc) && is_valid_rc(r + 2 * dr, c + 2 * dc) {
            m |= 1 << i;
        }
        i += 1;
    }
    m
}

const fn build_cells() -> [u8; 37] {
    let mut out = [0u8; 37];
    let (mut i, mut n) = (0, 0);
    while i < 49 {
        if is_valid_rc(i / 7, i % 7) {
            out[n] = i as u8;
            n += 1;
        }
        i += 1;
    }
    out
}

pub const VALID: Pos = build_valid();
pub const CELLS: [u8; 37] = build_cells();
pub const FULL: Pos = VALID;

const FROM_E: u64 = build_from(0, 1);
const FROM_W: u64 = build_from(0, -1);
const FROM_S: u64 = build_from(1, 0);
const FROM_N: u64 = build_from(-1, 0);
const DELTA: [i8; 4] = [1, -1, 7, -7];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Move {
    pub from: u8,
    pub over: u8,
    pub to: u8,
}

impl Move {
    pub fn new(from: u8, to: u8) -> Move {
        Move { from, over: (from + to) / 2, to }
    }
}

#[inline]
pub fn is_valid(i: u8) -> bool {
    i < 49 && VALID >> i & 1 == 1
}

#[inline]
pub fn occupied(p: Pos, i: u8) -> bool {
    p >> i & 1 == 1
}

/// Full board with one hole emptied.
#[inline]
pub fn start(hole: u8) -> Pos {
    FULL & !(1 << hole)
}

/// For each direction (E, W, S, N): the set of cells holding a marble that can jump that way.
#[inline]
fn jump_masks(p: Pos) -> [u64; 4] {
    let e = VALID & !p;
    [
        p & (p >> 1) & (e >> 2) & FROM_E,
        p & (p << 1) & (e << 2) & FROM_W,
        p & (p >> 7) & (e >> 14) & FROM_S,
        p & (p << 7) & (e << 14) & FROM_N,
    ]
}

#[inline]
pub fn has_moves(p: Pos) -> bool {
    let m = jump_masks(p);
    (m[0] | m[1] | m[2] | m[3]) != 0
}

#[inline]
pub fn apply(p: Pos, m: Move) -> Pos {
    p ^ (1 << m.from | 1 << m.over | 1 << m.to)
}

pub struct MoveIter {
    masks: [u64; 4],
    dir: usize,
}

impl Iterator for MoveIter {
    type Item = Move;

    #[inline]
    fn next(&mut self) -> Option<Move> {
        while self.dir < 4 {
            let m = self.masks[self.dir];
            if m != 0 {
                self.masks[self.dir] = m & (m - 1);
                let from = m.trailing_zeros() as i8;
                let d = DELTA[self.dir];
                return Some(Move { from: from as u8, over: (from + d) as u8, to: (from + 2 * d) as u8 });
            }
            self.dir += 1;
        }
        None
    }
}

#[inline]
pub fn moves(p: Pos) -> MoveIter {
    MoveIter { masks: jump_masks(p), dir: 0 }
}

/// Standard notation: file a–g is the column, rank 1–7 counts up from the bottom row.
pub fn label(i: u8) -> String {
    let (r, c) = (i / 7, i % 7);
    format!("{}{}", (b'a' + c) as char, 7 - r)
}

pub fn parse_label(s: &str) -> Option<u8> {
    let b = s.as_bytes();
    if b.len() != 2 || !(b'a'..=b'g').contains(&b[0]) || !(b'1'..=b'7').contains(&b[1]) {
        return None;
    }
    let i = (b'7' - b[1]) * 7 + (b[0] - b'a');
    is_valid(i).then_some(i)
}
