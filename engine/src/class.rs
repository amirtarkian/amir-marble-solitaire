//! Position class: a 4-bit invariant no jump can change.
//!
//! Colour the board along both diagonals with three colours, `(r+c) % 3` and
//! `(r-c) mod 3`. A jump touches three consecutive cells of a line, one of each colour,
//! so it flips the parity of every colour count. The parities of `n0+n1` and `n1+n2`
//! for each colouring therefore never change: 2 + 2 bits = 16 classes.

use crate::board::{Pos, CELLS};
use std::sync::OnceLock;

const fn build_masks(anti: bool) -> [u64; 3] {
    let mut out = [0u64; 3];
    let mut i = 0;
    while i < 49 {
        let (r, c) = (i / 7, i % 7);
        let k = if anti { (r + 6 - c) % 3 } else { (r + c) % 3 };
        out[k] |= 1 << i;
        i += 1;
    }
    out
}

const MASK_A: [u64; 3] = build_masks(false);
const MASK_B: [u64; 3] = build_masks(true);

#[inline]
pub fn class(p: Pos) -> u8 {
    let a = MASK_A.map(|m| (p & m).count_ones());
    let b = MASK_B.map(|m| (p & m).count_ones());
    (((a[0] + a[1]) & 1) | ((a[1] + a[2]) & 1) << 1 | ((b[0] + b[1]) & 1) << 2 | ((b[1] + b[2]) & 1) << 3) as u8
}

/// Fewest marbles any non-empty position of each class can have (0 = more than 4).
fn min_marbles_by_class() -> &'static [u8; 16] {
    static TABLE: OnceLock<[u8; 16]> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut best = [0u8; 16];
        let mut note = |p: Pos, n: u8| {
            let k = class(p) as usize;
            if best[k] == 0 || n < best[k] {
                best[k] = n;
            }
        };
        let cells = CELLS.map(|c| 1u64 << c);
        for (i, &a) in cells.iter().enumerate() {
            note(a, 1);
            for (j, &b) in cells.iter().enumerate().skip(i + 1) {
                note(a | b, 2);
                for (k, &c) in cells.iter().enumerate().skip(j + 1) {
                    note(a | b | c, 3);
                    for &d in cells.iter().skip(k + 1) {
                        note(a | b | c | d, 4);
                    }
                }
            }
        }
        best
    })
}

/// A lower bound on the marbles that must remain, from the class invariant alone.
#[inline]
pub fn lower_bound(p: Pos) -> u8 {
    let n = p.count_ones() as u8;
    if n <= 1 {
        return n;
    }
    let m = min_marbles_by_class()[class(p) as usize];
    if m == 0 { 1 } else { m.min(n) }
}
