# UI typography

The stylesheet prioritizes the device's system font (`-apple-system`, `BlinkMacSystemFont`) and Helvetica Neue / Apple SD Gothic Neo when available. Apple devices use their installed system fonts. Apple SF font files are not bundled or redistributed.

Other devices use the included Pretendard Variable as a Korean-capable fallback. It is distributed under the SIL Open Font License in OFL.txt.

- Font: Pretendard 1.3.9 by Kil Hyung-jin
- Official project: https://github.com/orioncactus/pretendard
- Pinned font source: https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/variable/woff2/PretendardVariable.woff2
- License source: https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/LICENSE

The server serves the font from this directory, and the service worker caches it for later offline use. No third-party font request is required while using the site.
