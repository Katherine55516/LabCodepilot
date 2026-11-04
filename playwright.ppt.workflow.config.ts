import {defineConfig} from '@playwright/test';
/** Reuses the isolated real application; never starts or stops another checkout's server. */
export default defineConfig({
 testDir:'./src/__tests__/e2e',testMatch:/ppt-(?:live-follow|prototype-parity|offline-components|math-integrity|render-contract|byok-setup)\.spec\.ts$/,
 fullyParallel:false,workers:1,retries:0,reporter:'list',expect:{timeout:15000},
 outputDir:process.env.PPT_TEST_RESULTS||'outputs/ppt-workflow-browser-results',timeout:90000,
 use:{baseURL:process.env.PPT_TEST_URL||'http://127.0.0.1:3143',channel:'chrome',headless:true,trace:'retain-on-failure',screenshot:'only-on-failure'},
});
