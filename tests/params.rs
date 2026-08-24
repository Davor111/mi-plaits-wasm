use mi_plaits_dsp::voice::{Modulations, Patch};
use mi_plaits_wasm::params;

#[test]
fn engine_is_clamped_to_valid_range() {
    let mut p = Patch::default();
    let mut m = Modulations::default();

    params::set(&mut p, &mut m, params::ENGINE, 7.0);
    assert_eq!(p.engine, 7);

    params::set(&mut p, &mut m, params::ENGINE, 99.0);
    assert_eq!(p.engine, 23, "above range must clamp to NUM_ENGINES - 1");

    params::set(&mut p, &mut m, params::ENGINE, -5.0);
    assert_eq!(p.engine, 0, "below range must clamp to 0");
}

#[test]
fn patch_ids_write_their_own_field() {
    let mut p = Patch::default();
    let mut m = Modulations::default();

    params::set(&mut p, &mut m, params::NOTE, 60.0);
    params::set(&mut p, &mut m, params::HARMONICS, 0.1);
    params::set(&mut p, &mut m, params::TIMBRE, 0.2);
    params::set(&mut p, &mut m, params::MORPH, 0.3);
    params::set(&mut p, &mut m, params::DECAY, 0.4);
    params::set(&mut p, &mut m, params::LPG_COLOUR, 0.6);
    params::set(&mut p, &mut m, params::FM_AMOUNT, 0.7);
    params::set(&mut p, &mut m, params::TIMBRE_MOD_AMOUNT, 0.8);
    params::set(&mut p, &mut m, params::MORPH_MOD_AMOUNT, 0.9);

    assert_eq!(p.note, 60.0);
    assert_eq!(p.harmonics, 0.1);
    assert_eq!(p.timbre, 0.2);
    assert_eq!(p.morph, 0.3);
    assert_eq!(p.decay, 0.4);
    assert_eq!(p.lpg_colour, 0.6);
    assert_eq!(p.frequency_modulation_amount, 0.7);
    assert_eq!(p.timbre_modulation_amount, 0.8);
    assert_eq!(p.morph_modulation_amount, 0.9);
}

#[test]
fn modulation_ids_write_their_own_field() {
    let mut p = Patch::default();
    let mut m = Modulations::default();

    params::set(&mut p, &mut m, params::MOD_ENGINE, 0.1);
    params::set(&mut p, &mut m, params::MOD_NOTE, 12.0);
    params::set(&mut p, &mut m, params::MOD_FREQUENCY, 0.2);
    params::set(&mut p, &mut m, params::MOD_HARMONICS, 0.3);
    params::set(&mut p, &mut m, params::MOD_TIMBRE, 0.4);
    params::set(&mut p, &mut m, params::MOD_MORPH, 0.5);
    params::set(&mut p, &mut m, params::MOD_TRIGGER, 1.0);
    params::set(&mut p, &mut m, params::MOD_LEVEL, 0.75);

    assert_eq!(m.engine, 0.1);
    assert_eq!(m.note, 12.0);
    assert_eq!(m.frequency, 0.2);
    assert_eq!(m.harmonics, 0.3);
    assert_eq!(m.timbre, 0.4);
    assert_eq!(m.morph, 0.5);
    assert_eq!(m.trigger, 1.0);
    assert_eq!(m.level, 0.75);
}

#[test]
fn flag_ids_are_boolean_by_nonzero() {
    let mut p = Patch::default();
    let mut m = Modulations::default();

    for id in [
        params::FREQUENCY_PATCHED,
        params::TIMBRE_PATCHED,
        params::MORPH_PATCHED,
        params::TRIGGER_PATCHED,
        params::LEVEL_PATCHED,
    ] {
        params::set(&mut p, &mut m, id, 1.0);
    }
    assert!(m.frequency_patched);
    assert!(m.timbre_patched);
    assert!(m.morph_patched);
    assert!(m.trigger_patched);
    assert!(m.level_patched);

    params::set(&mut p, &mut m, params::TRIGGER_PATCHED, 0.0);
    assert!(!m.trigger_patched);
}

#[test]
fn unknown_id_changes_nothing() {
    let mut p = Patch::default();
    let mut m = Modulations::default();
    let before = format!("{p:?}|{m:?}");

    params::set(&mut p, &mut m, 9999, 1.0);

    assert_eq!(before, format!("{p:?}|{m:?}"));
}
