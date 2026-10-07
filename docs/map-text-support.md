# Arabic map text support

Mapbox GL JS 3.32.0 registers the official mapbox-gl-rtl-text helper before map construction, once globally. Labels follow the application language with the native language/setLanguage API. Names are never reversed manually.

The pinned v0.2.3 JavaScript/asm.js helper is served from the app origin. It exports the three RTL plugin callbacks supported by the installed GL JS. The newer v0.3.0 helper requires WebAssembly compilation, which the current page CSP prohibits. Global wasm-unsafe-eval was rejected by automatic review and was not published. The compatible JavaScript helper avoids that permission entirely; the existing CSP is retained.

Source: https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.2.3/mapbox-gl-rtl-text.js
SHA-256: 142f4fc31b4911887bacfea4df1813df67be28dfcb4c56e3f8f576f2e6fdf5d2
License: public/mapbox-rtl-text-v0.2.3-LICENSE.txt (upstream v0.2.3 LICENSE.md).

The browser test executes the shipped helper in a real worker under the actual response CSP, checks shaping and bidi ordering of عمان, and checks that unsafe-eval/wasm-unsafe-eval are absent. Component tests check registration before map construction, duplicate prevention, language switching and map cleanup. This establishes text-engine setup, not visual acceptance of provider tiles/glyphs on the user's phone.
