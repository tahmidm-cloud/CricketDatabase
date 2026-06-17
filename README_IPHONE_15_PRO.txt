Cricket Manager V25 - iPhone 15 Pro Calibrated Package

Target phone viewport:
- iPhone 15 Pro portrait: 393 x 852 CSS pixels
- Safe-area support added for notch and home indicator

Files to use:
- index.html
- select-xi.html
- toss.html
- match-center.html
- player-database.html
- tour.css / tour.js
- toss.css / toss.js
- database.css / app.js
- mobile-iphone15pro.css
- mobile-viewport.js

What changed:
1. Added viewport-fit=cover to app pages.
2. Added mobile-iphone15pro.css to all main pages.
3. Added mobile-viewport.js to fix Safari/iPhone viewport height issues.
4. Match Center now uses phone compact layout below 430px.
5. Buttons are touch-sized.
6. Horizontal overflow is blocked.
7. Large panels use internal scrolling instead of breaking the screen.
8. Debug panel is hidden on phone to save space.

How to test locally:
1. Replace your existing frontend files with this package.
2. Open index.html or run with Live Server.
3. In Chrome DevTools, choose iPhone 15 Pro viewport.
4. On real iPhone, open through GitHub Pages or local network.
5. Press Reset Match once after replacing match-center.html.

Do not delete mobile-iphone15pro.css or mobile-viewport.js; all pages link to them.
