//! Exact search: the fewest marbles that can remain from a position.
//!
//! `reach(p, t)` answers "can play from `p` end with at most `t` marbles?" by DFS. A
//! transposition table keyed by the canonical position stores proven bounds
//! (`lb <= value <= ub`), so work survives across calls and across budget slices.

use crate::board::{apply, has_moves, moves, Move, Pos};
use crate::class::lower_bound;
use crate::opening::OpeningTable;
use crate::symmetry::canon;
use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

pub const UNLIMITED: u64 = u64::MAX;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OutOfBudget;

/// splitmix64 finaliser: positions differ mostly in high bits, so mix everything.
#[derive(Default)]
struct Mix(u64);

impl Hasher for Mix {
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.write_u64(b as u64);
        }
    }

    #[inline]
    fn write_u64(&mut self, x: u64) {
        let mut z = x ^ self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        self.0 = z ^ (z >> 31);
    }

    fn finish(&self) -> u64 {
        self.0
    }
}

#[derive(Clone, Copy)]
struct Bounds {
    lb: u8,
    ub: u8,
}

pub struct Solver {
    tt: HashMap<Pos, Bounds, BuildHasherDefault<Mix>>,
    opening: Option<OpeningTable>,
    nodes: u64,
    limit: u64,
    max_entries: usize,
}

impl Default for Solver {
    fn default() -> Self {
        Self::new()
    }
}

impl Solver {
    pub fn new() -> Self {
        Solver { tt: HashMap::default(), opening: None, nodes: 0, limit: UNLIMITED, max_entries: 20_000_000 }
    }

    pub fn set_opening(&mut self, table: OpeningTable) {
        self.opening = Some(table);
    }

    /// Cap on transposition-table entries; the table is cleared when it fills up.
    pub fn set_max_entries(&mut self, n: usize) {
        self.max_entries = n;
    }

    pub fn clear(&mut self) {
        self.tt.clear();
    }

    /// Nodes expanded since this solver was created.
    pub fn nodes(&self) -> u64 {
        self.nodes
    }

    pub fn tt_len(&self) -> usize {
        self.tt.len()
    }

    fn start_budget(&mut self, budget: u64) {
        self.limit = self.nodes.saturating_add(budget);
    }

    fn bounds(&self, p: Pos, key: Pos) -> Bounds {
        if let Some(v) = self.opening.as_ref().and_then(|t| t.lookup(p, key)) {
            return Bounds { lb: v, ub: v };
        }
        let n = p.count_ones() as u8;
        let mut b = Bounds { lb: lower_bound(p), ub: n };
        if let Some(e) = self.tt.get(&key) {
            b.lb = b.lb.max(e.lb);
            b.ub = b.ub.min(e.ub);
        }
        b
    }

    fn store(&mut self, key: Pos, lb: u8, ub: u8) {
        if self.tt.len() >= self.max_entries {
            self.tt.clear();
        }
        let e = self.tt.entry(key).or_insert(Bounds { lb: 0, ub: u8::MAX });
        e.lb = e.lb.max(lb);
        e.ub = e.ub.min(ub);
    }

    fn reach(&mut self, p: Pos, t: u8) -> Result<bool, OutOfBudget> {
        let n = p.count_ones() as u8;
        if n <= t {
            return Ok(true); // jumping only ever lowers the count
        }
        let key = canon(p);
        let b = self.bounds(p, key);
        if b.lb > t {
            return Ok(false);
        }
        if b.ub <= t {
            return Ok(true);
        }
        self.nodes += 1;
        if self.nodes > self.limit {
            return Err(OutOfBudget);
        }
        let mut any = false;
        for m in moves(p) {
            any = true;
            if self.reach(apply(p, m), t)? {
                self.store(key, 0, t);
                return Ok(true);
            }
        }
        if any {
            self.store(key, t + 1, u8::MAX);
        } else {
            self.store(key, n, n);
        }
        Ok(false)
    }

    /// Can play from `p` end with at most `t` marbles?
    pub fn can_reach(&mut self, p: Pos, t: u8, budget: u64) -> Result<bool, OutOfBudget> {
        self.start_budget(budget);
        self.reach(p, t)
    }

    fn value_inner(&mut self, p: Pos) -> Result<u8, OutOfBudget> {
        let mut t = self.bounds(p, canon(p)).lb;
        while !self.reach(p, t)? {
            t += 1;
        }
        Ok(t)
    }

    /// The fewest marbles that can remain from `p`.
    pub fn value(&mut self, p: Pos, budget: u64) -> Result<u8, OutOfBudget> {
        self.start_budget(budget);
        self.value_inner(p)
    }

    /// An optimal sequence of moves from `p` to a finish with `value(p)` marbles.
    pub fn best_line(&mut self, p: Pos, budget: u64) -> Result<Vec<Move>, OutOfBudget> {
        self.start_budget(budget);
        let v = self.value_inner(p)?;
        let mut line = Vec::new();
        let mut cur = p;
        while has_moves(cur) {
            let mut next = None;
            for m in moves(cur) {
                if self.reach(apply(cur, m), v)? {
                    next = Some(m);
                    break;
                }
            }
            let m = next.expect("a position with value v has a child with value v");
            line.push(m);
            cur = apply(cur, m);
        }
        Ok(line)
    }

    /// Every legal move with the exact value of the position it leads to.
    pub fn move_values(&mut self, p: Pos, budget: u64) -> Result<Vec<(Move, u8)>, OutOfBudget> {
        self.start_budget(budget);
        let ms: Vec<Move> = moves(p).collect();
        let mut out = Vec::with_capacity(ms.len());
        for m in ms {
            out.push((m, self.value_inner(apply(p, m))?));
        }
        Ok(out)
    }
}
