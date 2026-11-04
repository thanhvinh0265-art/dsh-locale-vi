# dsh-locale-vi

Vietnamese language pack for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

Adds **Tiếng Việt** to the DSH Web UI language picker and ships a Vietnamese dictionary for every
client plugin that publishes English strings through `ctx.locale`.

| | |
|---|---|
| Languages added | `vi` (fallback `en`) |
| Namespaces | **29** |
| Translated keys | **2,354** |
| Source strings | ~46,400 characters of English |
| Dependencies | none |
| Host code | optional: the `/vi-sync` command (re-scans installed plugins for new English strings) |

## Install

```sh
dsh plugin --profile <profile> add github:thanhvinh0265-art/dsh-locale-vi
```

Or, on a desktop build, install it from the app's own **Settings → Plugins** page and reload the page.
Then open **Settings → Language → Tiếng Việt**.

## How it works

DSH's client locale service has a language-pack API. This package uses two calls and nothing else:

```js
ctx.locale.addLanguage({ id: 'vi', label: 'Tiếng Việt', fallback: 'en' });
ctx.locale.register(namespace, 'vi', dictionary);   // one call per namespace
```

It never patches, forks, or rewrites DSH source. Every registration is disposed in the plugin's
`ctx.effect` clean-up, so disabling the bundle restores the previous language list.

Translation lookup walks the fallback chain (`vi` → `en` → `common` → the key itself), so a string
added upstream after this release renders in English instead of showing a raw key, and nothing breaks
when a plugin renames a namespace.

## Coverage and limits

Translated: `chat`, `conversation`, `trajectory`, `workspace`, `dsh-context` (706 keys),
`dsh-pdf-mineru`, `dsh-deepseek-usage`, `subagent`, `job`, `plan`, `goal`, `skill`, `feedback`,
`command`, `model`, `cordis`, `sidebar*`, `open-in-app`, `deliverables`, `schedule.catalog`,
`settings.theme`, `settings.locale`.

Not translated, by design of the mechanism: plugins that hard-code English and publish no dictionary,
the shell strings in DSH's own frontend bundle, and everything on the Host side (tool descriptions,
system prompt, command output, logs).

## Maintenance

When DSH or a plugin updates, new keys appear in English. Refresh the corpus and see what changed:

```sh
python extract_locale.py && python split_en.py
python sync_vi.py            # lists new keys and writes pending/<ns>.json
python build_client.py       # regenerates client.js from vi/*.json
node test_client.mjs         # dry-run: registers 29 namespaces in a stub ctx
```

A missing key is never an error — it falls back to English.

## Refresh without a rebuild: `/vi-sync`

You do not have to run the Python pipeline above. After installing a plugin (or updating DSH) and
seeing English strings, type this in the chat composer:

```
/vi-sync
```

The Host half re-scans every installed client bundle, diffs it against `locale/dict.json`, and
translates only the missing strings through DSH's own `translator` service using its **anonymous
Google/Bing route** — no API key, no DeepSeek tokens, no per-user cost. It then rewrites
`locale/dict.json` and the `VI-DICTS-BEGIN … VI-DICTS-END` block of `client.js`; press `Ctrl+R`
and the new strings are Vietnamese.

Limits: up to 250 new strings per run, four translations in flight, and it needs the Host to expose
a `translator` service with an anonymous provider (the desktop build does). A machine without it
keeps the shipped dictionary and simply reports that it cannot translate.

## License

MIT.

---

## Tiếng Việt

Gói ngôn ngữ tiếng Việt cho DeepSeek Harness: thêm **Tiếng Việt** vào menu chọn ngôn ngữ của giao diện
Web và nạp từ điển cho mọi plugin client có phát hành chuỗi tiếng Anh qua `ctx.locale`.

**2.354 khoá / 29 namespace / ~46.400 ký tự** đã dịch, gồm trọn bộ `dsh-context` (706 khoá).

Cài: làm theo **Settings → Plugins** của app, hoặc `dsh plugin --profile <profile> add dsh-locale-vi`,
rồi tải lại trang và chọn **Cài đặt → Ngôn ngữ → Tiếng Việt**.

Khoá nào chưa dịch sẽ hiện tiếng Anh — không lỗi, không vỡ giao diện.

**Khi có chuỗi tiếng Anh mới** (DSH cập nhật, hoặc vừa cài thêm plugin): gõ `/vi-sync` trong ô chat.
Host half sẽ tự quét các plugin đang cài, tìm khoá còn thiếu, gọi dịch vụ dịch của chính DSH (route
Google/Bing miễn phí, **không cần API key, không tốn tiền**) rồi ghi lại từ điển; bấm `Ctrl+R` là xong.
Mỗi lượt tối đa 250 chuỗi.

Giấy phép MIT.
