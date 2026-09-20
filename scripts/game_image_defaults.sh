#!/usr/bin/env bash

# Fuente única para las imágenes de juegos utilizadas por la creación de
# instancias, la actualización de plantillas y el precalentamiento local.
apply_game_image_defaults() {
  : "${RUST_BASE_IMAGE:=indifferentbroccoli/rust-server-docker@sha256:65d0b48cb2130041c59837a25351e985a680e5289f6219619ae2c4771e6c797a}"
  : "${PALWORLD_BASE_IMAGE:=thijsvanloef/palworld-server-docker@sha256:39059e157ea5148f7c4f66c2913c9e844fd62b9fd9de1e7200de8bb4d9bd7a8f}"
  : "${CS2_BASE_IMAGE:=cm2network/cs2@sha256:182f37326df93a8893d3c604a2c2c2a2164e40d126d4d5a71835b2610b913af7}"
  : "${VALHEIM_BASE_IMAGE:=lloesche/valheim-server@sha256:20fde516ce311e6084f82f295c9eb6934af57b357c657937a04f62bdf5946149}"
  : "${ZOMBOID_BASE_IMAGE:=renegademaster/zomboid-dedicated-server@sha256:5e3479ea2ef66a4f14686fd3abc3286cf31a82c0e37f737b4b5976ff37da9951}"
  : "${ARK_BASE_IMAGE:=auhrus/arksurvivalascended-server@sha256:b823987de2e84a2af73e74ee2cdb6e7bc0fc01bdf79409abe930bb091e93927a}"
  : "${SDTD_BASE_IMAGE:=didstopia/7dtd-server@sha256:b7d5822cbcb73116d6d1a04948f27e2edb38739dd62af0fdc41f8dbffb7af9ed}"
  export RUST_BASE_IMAGE PALWORLD_BASE_IMAGE CS2_BASE_IMAGE VALHEIM_BASE_IMAGE
  export ZOMBOID_BASE_IMAGE ARK_BASE_IMAGE SDTD_BASE_IMAGE
}
