//! The board's 8 symmetries (dihedral group D4) and canonical forms.
//!
//! Transform ids: 0 identity, 1 rot90, 2 rot180, 3 rot270, 4 mirror (columns),
//! 5 flip (rows), 6 transpose, 7 anti-transpose.

use crate::board::{start, Pos};

const fn map_rc(t: usize, r: usize, c: usize) -> (usize, usize) {
    match t {
        0 => (r, c),
        1 => (c, 6 - r),
        2 => (6 - r, 6 - c),
        3 => (6 - c, r),
        4 => (r, 6 - c),
        5 => (6 - r, c),
        6 => (c, r),
        _ => (6 - c, 6 - r),
    }
}

/// `ROW_T[t][r][bits]` = image under transform `t` of row `r` holding `bits`.
const fn build_row_tables() -> [[[u64; 128]; 7]; 8] {
    let mut out = [[[0u64; 128]; 7]; 8];
    let mut t = 0;
    while t < 8 {
        let mut r = 0;
        while r < 7 {
            let mut bits = 0;
            while bits < 128 {
                let mut img = 0u64;
                let mut c = 0;
                while c < 7 {
                    if bits >> c & 1 == 1 {
                        let (r2, c2) = map_rc(t, r, c);
                        img |= 1 << (r2 * 7 + c2);
                    }
                    c += 1;
                }
                out[t][r][bits] = img;
                bits += 1;
            }
            r += 1;
        }
        t += 1;
    }
    out
}

static ROW_T: [[[u64; 128]; 7]; 8] = build_row_tables();

/// `INVERSE[t]` undoes transform `t`.
pub const INVERSE: [u8; 8] = [0, 3, 2, 1, 4, 5, 6, 7];

/// One starting hole per symmetry class: d4, d5, d6, d7, e5, e6, e7, f6.
pub const ORBIT_REPS: [u8; 8] = [24, 17, 10, 3, 18, 11, 4, 12];

#[inline]
pub fn transform(t: u8, p: Pos) -> Pos {
    let tab = &ROW_T[t as usize];
    tab[0][(p & 127) as usize]
        | tab[1][(p >> 7 & 127) as usize]
        | tab[2][(p >> 14 & 127) as usize]
        | tab[3][(p >> 21 & 127) as usize]
        | tab[4][(p >> 28 & 127) as usize]
        | tab[5][(p >> 35 & 127) as usize]
        | tab[6][(p >> 42 & 127) as usize]
}

pub fn transform_cell(t: u8, i: u8) -> u8 {
    let (r, c) = map_rc(t as usize, (i / 7) as usize, (i % 7) as usize);
    (r * 7 + c) as u8
}

/// Smallest of the 8 images: the key for transposition tables and the solver.
#[inline]
pub fn canon(p: Pos) -> Pos {
    let mut best = p;
    for t in 1..8 {
        let q = transform(t, p);
        if q < best {
            best = q;
        }
    }
    best
}

/// Canonical form plus a transform `t` with `transform(t, p) == canon(p)`.
pub fn canon_with_t(p: Pos) -> (Pos, u8) {
    let mut best = (p, 0);
    for t in 1..8 {
        let q = transform(t, p);
        if q < best.0 {
            best = (q, t);
        }
    }
    best
}

/// The representative in `ORBIT_REPS` of the starting hole `hole`.
pub fn orbit_rep(hole: u8) -> u8 {
    let key = canon(start(hole));
    *ORBIT_REPS.iter().find(|&&h| canon(start(h)) == key).expect("every hole has a representative")
}
