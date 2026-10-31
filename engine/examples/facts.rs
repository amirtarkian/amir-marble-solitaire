// Prints board facts used by the Learn page.
use engine::board::*;
use engine::class::class;
use engine::symmetry::ORBIT_REPS;
fn main() {
    let valid = |r: i32, c: i32| (0..7).contains(&r) && (0..7).contains(&c) && is_valid((r * 7 + c) as u8);
    let unjumpable: Vec<String> = CELLS.iter().filter(|&&i| {
        let (r, c) = ((i / 7) as i32, (i % 7) as i32);
        !(valid(r, c - 1) && valid(r, c + 1)) && !(valid(r - 1, c) && valid(r + 1, c))
    }).map(|&i| label(i)).collect();
    println!("cannot be jumped over ({}): {}", unjumpable.len(), unjumpable.join(" "));
    println!("class(full board) = {}", class(VALID));
    for &h in ORBIT_REPS.iter() {
        let k = class(start(h));
        let finals: Vec<String> = CELLS.iter().filter(|&&f| class(1u64 << f) == k).map(|&f| label(f)).collect();
        println!("start {}: single-marble finish possible only on [{}]", label(h), finals.join(" "));
    }
    // Rule-of-three check: is f ≡ h (mod 3 in both coordinates) the same as the class test?
    for &h in CELLS.iter() {
        let k = class(start(h));
        for &f in CELLS.iter() {
            let same = class(1u64 << f) == k;
            let (hr, hc, fr, fc) = (h / 7, h % 7, f / 7, f % 7);
            let three = (hr as i32 - fr as i32).rem_euclid(3) == 0 && (hc as i32 - fc as i32).rem_euclid(3) == 0;
            let _ = (same, three);
        }
    }
}
