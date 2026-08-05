const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  // Navigate to panel directly and inject auth
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle2' });
  await page.evaluate(() => {
    localStorage.setItem('nexus_user', JSON.stringify({role: 'admin', is_verified: true, email: 'test@test.com'}));
    localStorage.setItem('nexus_token', 'test-token');
  });
  
  await page.goto('http://localhost:3000/panel', { waitUntil: 'networkidle2' });
  await page.waitForTimeout(3000);
  
  // Capture any console errors
  page.on('console', msg => console.log('BROWSER_LOG:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER_ERROR:', err.toString()));
  
  await page.screenshot({ path: 'debug_screenshot.png' });
  await browser.close();
  console.log("Screenshot saved as debug_screenshot.png");
})();
