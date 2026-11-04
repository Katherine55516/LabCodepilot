import {defineConfig} from '@playwright/test';
// The isolated model-only fixture service must already be running. Never
// launch or reuse the user's protected 3141 service through this config.
export default defineConfig({testDir:'./src/__tests__/e2e',testMatch:/ppt-template-first-live\.spec\.ts$/,workers:1,retries:0,reporter:'list',timeout:1_200_000,expect:{timeout:30_000},outputDir:'outputs/ppt-template-first-implementation-20261019/playwright-live',use:{baseURL:'http://127.0.0.1:3143',headless:true,actionTimeout:30000,viewport:{width:1440,height:1050},trace:'retain-on-failure',screenshot:'only-on-failure'}});
