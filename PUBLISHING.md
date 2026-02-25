# Publishing Checklist

`@livetoon/lipsync-wasm` を npm に public 公開するための実運用チェックリストです。

## 0. 前提

- npm publish 権限を持つアカウントで作業している
- 作業ブランチに公開したい変更だけが含まれている

## 1. 版上げ

用途に応じて 1 つ実行:

```bash
npm version patch
# or
npm version minor
# or
npm version major
```

## 2. verify / build / publish-check

```bash
make install
make verify
make publish-check
```

確認ポイント:

- `make verify` が成功する
- `npm pack --dry-run` に不要ファイルが含まれていない

## 3. npm login / 2FA

```bash
npm whoami || npm login
```

- npm アカウントで 2FA が有効な場合は、publish 時に OTP 入力が必要

## 4. publish

### 初回公開

```bash
npm publish --access public
```

### 2回目以降の更新公開

```bash
npm publish
```

## 5. 公開後確認

```bash
npm view @livetoon/lipsync-wasm version
npm view @livetoon/lipsync-wasm dist-tags
```

必要に応じてクリーン環境で導入確認:

```bash
mkdir -p /tmp/lipsync-wasm-smoke && cd /tmp/lipsync-wasm-smoke
npm init -y
npm install @livetoon/lipsync-wasm
node -e "import('@livetoon/lipsync-wasm').then(() => console.log('ok'))"
```
