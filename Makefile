.DEFAULT_GOAL := help

NPM ?= npm

.PHONY: help install typecheck build check-wasm build-wasm rebuild-wasm \
	example-install example-dev example-build verify publish-check

help:
	@printf "lipsync-wasm Make targets\n\n"
	@printf "  make install         Install root dependencies\n"
	@printf "  make typecheck       Run TypeScript typecheck\n"
	@printf "  make build           Build package (WASM ensure + TS)\n"
	@printf "  make check-wasm      Check WASM artifacts/toolchain\n"
	@printf "  make build-wasm      Build WASM from Rust\n"
	@printf "  make rebuild-wasm    Rebuild WASM from Rust\n"
	@printf "  make example-install Install VRM+Mic example dependencies\n"
	@printf "  make example-dev     Run VRM+Mic example in dev mode\n"
	@printf "  make example-build   Build VRM+Mic example\n"
	@printf "  make verify          Run major checks/builds\n"
	@printf "  make publish-check   Verify package contents with npm pack\n"

install:
	$(NPM) install

typecheck:
	$(NPM) run typecheck

build:
	$(NPM) run build

check-wasm:
	$(NPM) run check:wasm

build-wasm:
	$(NPM) run build:wasm

rebuild-wasm:
	$(NPM) run rebuild:wasm

example-install:
	$(NPM) run example:vrm-mic:install

example-dev:
	$(NPM) run example:vrm-mic

example-build:
	$(NPM) run example:vrm-mic:build

verify:
	$(NPM) run verify

publish-check:
	$(NPM) run publish:check
