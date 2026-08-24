use mi_plaits_dsp::voice::NUM_ENGINES;
use mi_plaits_wasm::{Synth, params};

const BLOCK: usize = 128;
const SR: f32 = 48000.0;

fn triggered_synth(engine: usize) -> Synth {
    let mut s = Synth::new(BLOCK, SR);
    s.set_param(params::ENGINE, engine as f32);
    s.set_param(params::TRIGGER_PATCHED, 1.0);
    s.set_param(params::LEVEL_PATCHED, 1.0);
    s.set_param(params::MOD_LEVEL, 1.0);
    s.set_param(params::MOD_TRIGGER, 1.0);
    s
}

#[test]
fn buffers_have_the_requested_block_size() {
    let s = Synth::new(BLOCK, SR);
    assert_eq!(s.out().len(), BLOCK);
    assert_eq!(s.aux().len(), BLOCK);
}

#[test]
fn every_engine_renders_finite_non_silent_audio() {
    for engine in 0..NUM_ENGINES {
        let mut s = triggered_synth(engine);
        let mut peak = 0.0f32;

        for _ in 0..200 {
            s.render();
            for &x in s.out().iter().chain(s.aux().iter()) {
                assert!(x.is_finite(), "engine {engine} produced a non-finite sample: {x}");
                peak = peak.max(x.abs());
            }
        }

        assert!(peak > 1e-5, "engine {engine} rendered silence (peak {peak})");
    }
}

#[test]
fn out_and_aux_pointers_address_the_rendered_buffers() {
    let mut s = triggered_synth(0);
    for _ in 0..64 {
        s.render();
    }

    let ptr = s.out_ptr();
    let via_ptr = unsafe { std::slice::from_raw_parts(ptr, BLOCK) };
    assert_eq!(via_ptr, s.out(), "out_ptr must alias the out buffer");

    let ptr = s.aux_ptr();
    let via_ptr = unsafe { std::slice::from_raw_parts(ptr, BLOCK) };
    assert_eq!(via_ptr, s.aux(), "aux_ptr must alias the aux buffer");
}
