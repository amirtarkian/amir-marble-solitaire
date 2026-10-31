//! The engine for the browser, as plain C-ABI exports (no wasm-bindgen).
//!
//! Positions cross the boundary as `u64` (a JS `BigInt`). Functions that return lists
//! write bytes to an output buffer at `out_ptr()` and return how many items they wrote.
//! Every search takes a node budget and returns -1 when it runs out; the transposition
//! table keeps the progress, so calling again with the same position resumes the work.

use engine::board::{Pos, VALID};
use engine::opening::OpeningTable;
use engine::search::Solver;
use std::cell::RefCell;

thread_local! {
    // 2^23 slots = 64 MB of transposition table.
    static SOLVER: RefCell<Solver> = RefCell::new(Solver::with_table_bits(23));
    static OUT: RefCell<Vec<u8>> = RefCell::new(Vec::with_capacity(256));
}

fn with_solver<T>(f: impl FnOnce(&mut Solver) -> T) -> T {
    SOLVER.with(|s| f(&mut s.borrow_mut()))
}

fn write_out(bytes: impl IntoIterator<Item = u8>) {
    OUT.with(|o| {
        let mut o = o.borrow_mut();
        o.clear();
        o.extend(bytes);
    });
}

#[no_mangle]
pub extern "C" fn out_ptr() -> *const u8 {
    OUT.with(|o| o.borrow().as_ptr())
}

/// Reserve `len` bytes for the caller to fill (used to hand over the opening table).
#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// Takes ownership of a buffer from `alloc`; returns entries loaded, or -1 if invalid.
#[no_mangle]
pub extern "C" fn load_opening(ptr: *mut u8, len: usize) -> i32 {
    let bytes = unsafe { Vec::from_raw_parts(ptr, len, len) };
    match OpeningTable::decode(&bytes) {
        Ok(t) => {
            let n = t.len() as i32;
            with_solver(|s| {
                s.clear();
                s.set_opening(t)
            });
            n
        }
        Err(_) => -1,
    }
}

#[no_mangle]
pub extern "C" fn value(pos: Pos, budget: u32) -> i32 {
    with_solver(|s| s.value(pos & VALID, budget as u64).map_or(-1, |v| v as i32))
}

/// 1 if play from `pos` can end with at most `t` marbles, 0 if not, -1 out of budget.
#[no_mangle]
pub extern "C" fn can_reach(pos: Pos, t: u32, budget: u32) -> i32 {
    with_solver(|s| s.can_reach(pos & VALID, t as u8, budget as u64).map_or(-1, |b| b as i32))
}

/// Writes an optimal line as (from, to) byte pairs; returns its length.
#[no_mangle]
pub extern "C" fn best_line(pos: Pos, budget: u32) -> i32 {
    with_solver(|s| match s.best_line(pos & VALID, budget as u64) {
        Ok(line) => {
            write_out(line.iter().flat_map(|m| [m.from, m.to]));
            line.len() as i32
        }
        Err(_) => -1,
    })
}

/// Writes every legal move as (from, to, value) byte triples; returns the move count.
#[no_mangle]
pub extern "C" fn move_values(pos: Pos, budget: u32) -> i32 {
    with_solver(|s| match s.move_values(pos & VALID, budget as u64) {
        Ok(mv) => {
            write_out(mv.iter().flat_map(|(m, v)| [m.from, m.to, *v]));
            mv.len() as i32
        }
        Err(_) => -1,
    })
}

#[no_mangle]
pub extern "C" fn clear() {
    with_solver(|s| s.clear());
}

#[no_mangle]
pub extern "C" fn nodes() -> f64 {
    with_solver(|s| s.nodes() as f64)
}
