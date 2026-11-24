#[test]
fn export_ts_bindings_integration() {
    let builder = hosila_ims_lib::specta_builder();
    hosila_ims_lib::export_ts_bindings(&builder).expect("TypeScript bindings export failed");
}
