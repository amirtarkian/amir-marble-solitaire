//! Exact search: the fewest marbles that can remain from a position.
//!
//! `reach(p, t)` answers "can play from `p` end with at most `t` marbles?" by DFS. A
//! transposition table keyed by the canonical position stores proven bounds
//! (`lb <= value <= ub`), so work survives across calls and across budget slices.

use crate::board::{apply, has_moves, moves, Move, Pos};
use crate::class::lower_bound;
use crate::opening::OpeningTable;
use crate::symmetry::canon;

pub const UNLIMITED: u64 = u64::MAX;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OutOfBudget;

#[inline]
fn mix(x: u64) -> u64 {
    // splitmix64 finaliser: positions differ mostly in high bits, so mix everything.
    let mut z = x;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

#[derive(Clone, Copy)]
struct Bounds {
    lb: u8,
    ub: u8,
}

/// Fixed-size, 4-way set-associative table. Each slot packs `key << 12 | lb << 6 | ub`
/// into one u64 (0 = empty). When a bucket is full, the entry with the fewest marbles is
/// evicted: it is the cheapest to recompute.
struct Table {
    slots: Vec<u64>,
    mask: usize,
    len: usize,
}

impl Table {
    fn new(log2_slots: u32) -> Table {
        let n = 1usize << log2_slots.max(2);
        Table { slots: vec![0; n], mask: n - 1, len: 0 }
    }

    #[inline]
    fn bucket(&self, key: Pos) -> usize {
        (mix(key) as usize) & self.mask & !3
    }

    #[inline]
    fn get(&self, key: Pos) -> Option<Bounds> {
        let b = self.bucket(key);
        self.slots[b..b + 4]
            .iter()
            .find(|&&s| s >> 12 == key && s != 0)
            .map(|&s| Bounds { lb: (s >> 6 & 63) as u8, ub: (s & 63) as u8 })
    }

    fn put(&mut self, key: Pos, lb: u8, ub: u8) {
        let b = self.bucket(key);
        let pack = |lb: u8, ub: u8| key << 12 | (lb.min(63) as u64) << 6 | ub.min(63) as u64;
        let bucket = &mut self.slots[b..b + 4];
        if let Some(s) = bucket.iter_mut().find(|s| **s >> 12 == key && **s != 0) {
            let (old_lb, old_ub) = ((*s >> 6 & 63) as u8, (*s & 63) as u8);
            *s = pack(old_lb.max(lb), old_ub.min(ub));
            return;
        }
        let victim = match bucket.iter().position(|&s| s == 0) {
            Some(i) => {
                self.len += 1;
                i
            }
            None => (0..4).min_by_key(|&i| (bucket[i] >> 12).count_ones()).unwrap(),
        };
        bucket[victim] = pack(lb, ub);
    }

    fn clear(&mut self) {
        self.slots.fill(0);
        self.len = 0;
    }
}

pub struct Solver {
    tt: Table,
    opening: Option<OpeningTable>,
    nodes: u64,
    limit: u64,
}

impl Default for Solver {
    fn default() -> Self {
        Self::new()
    }
}

impl Solver {
    /// A solver with a 2^24-slot (128 MB) transposition table.
    pub fn new() -> Self {
        Self::with_table_bits(24)
    }

    /// A solver whose transposition table has `2^bits` slots of 8 bytes each.
    pub fn with_table_bits(bits: u32) -> Self {
        Solver { tt: Table::new(bits), opening: None, nodes: 0, limit: UNLIMITED }
    }

    pub fn set_opening(&mut self, table: OpeningTable) {
        self.opening = Some(table);
    }

    pub fn clear(&mut self) {
        self.tt.clear();
    }

    /// Nodes expanded since this solver was created.
    pub fn nodes(&self) -> u64 {
        self.nodes
    }

    /// Occupied transposition-table slots.
    pub fn tt_len(&self) -> usize {
        self.tt.len
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
        if let Some(e) = self.tt.get(key) {
            b.lb = b.lb.max(e.lb);
            b.ub = b.ub.min(e.ub);
        }
        b
    }

    fn store(&mut self, key: Pos, lb: u8, ub: u8) {
        self.tt.put(key, lb, ub);
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

    /// The value of `p`, and every legal move with whether it keeps that value.
    /// Cheaper than `move_values`: a losing move only needs one failed proof.
    pub fn grade_moves(&mut self, p: Pos, budget: u64) -> Result<(u8, Vec<(Move, bool)>), OutOfBudget> {
        self.start_budget(budget);
        let v = self.value_inner(p)?;
        let ms: Vec<Move> = moves(p).collect();
        let mut out = Vec::with_capacity(ms.len());
        for m in ms {
            out.push((m, self.reach(apply(p, m), v)?));
        }
        Ok((v, out))
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
