import {defineConfig} from '@playwright/test';
// PPT acceptance always uses installed Google Chrome and the user's fixed
// production UI endpoint. No alternate browser or random-port fallback.
export default defineConfig({
 testDir:'./src/__tests__/e2e',testMatch:/(?:^|[\/])ppt-[^\/]*\.spec\.ts$/,
 fullyParallel:false,workers:1,retries:0,reporter:'list',
 use:{baseURL:'http://127.0.0.1:3141',channel:'chrome',headless:false,trace:'retain-on-failure',screenshot:'only-on-failure',video:'retain-on-failure'},
});
