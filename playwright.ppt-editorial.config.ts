import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./src/__tests__/e2e',testMatch:/ppt-(template-first-live|editorial-composer)\.spec\.ts/,
 fullyParallel:false,workers:1,retries:0,timeout:1800000,expect:{timeout:30000},
 outputDir:'outputs/ppt-ml-editorial-20261020/playwright',reporter:[['list'],['json',{outputFile:'outputs/ppt-ml-editorial-20261020/playwright-results.json'}]],
 use:{baseURL:'http://127.0.0.1:3143',actionTimeout:30000,navigationTimeout:120000,channel:'chrome',headless:true,viewport:{width:1440,height:1100},acceptDownloads:true,trace:'retain-on-failure',screenshot:'only-on-failure'},
});
