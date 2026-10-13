import {selectPptOption} from '../helpers';
import { test, expect } from '@playwright/test';

test('PPT M5 blocked quality gate stays editable and publishes only after repair @smoke', async ({ page }) => {
  // This full settings/editor journey includes cold Next route compilation.
  test.setTimeout(90000);
  const id = '9'.repeat(32);
  const now = new Date().toISOString();
  let project = {
    id,
    title: 'Needs repair',
    prompt: 'Evidence review',
    pages: 1,
    template: 'light',
    templateSpec: {
      id: 'light',
      name: 'Light',
      version: 1,
      palette: {
        background: '#ffffff',
        accent: '#7657e8',
        foreground: '#1f2937',
        muted: '#4b5563',
      },
      fonts: {
        title: 'Noto Serif CJK SC',
        body: 'Noto Sans CJK SC',
        titleEastAsia: 'Noto Serif CJK SC',
        bodyEastAsia: 'Noto Sans CJK SC',
        cjkExplicit: true,
      },
    },
    status: 'quality_blocked',
    stage: 'repair',
    error: 'PPT quality gate blocked publish: missing source',
    outline: [{ id: '1', title: 'Evidence', focus: 'Evidence', refs: [] }],
    deck: {
      slides: [
        {
          id: '1',
          title: 'Evidence',
          bullets: ['Revenue 42'],
          blocks: [] as unknown[],
          layoutId: 'summary',
        },
      ],
    },
    quality: {
      status: 'blocked',
      deterministic: {
        issues: [
          {
            code: 'numeric_source',
            severity: 'error',
            message: 'missing source',
          },
        ],
        hardErrors: 1,
      },
      modelReview: {
        missing: [],
        repeated: [],
        conflicts: [],
        unsupported: [],
      },
      repairs: [],
    },
    revision: 0,
    favorite: false,
    pinned: false,
    folderId: null,
    tags: [],
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await page.route('**/api/ppt/folders**', (route) => route.fulfill({ json: { folders: [] } }));
  await page.route('**/api/ppt/templates**', (route) =>
    route.fulfill({
      json: {
        templates: [
          {
            id: 'light',
            name: 'Light',
            compatibility: 'mapped',
            palette: project.templateSpec.palette,
          },
        ],
      },
    }),
  );
  await page.route('**/api/ppt/projects**', (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' && url.pathname === '/api/ppt/projects') return route.fulfill({ json: { projects: [project] } });
    if (route.request().method() === 'GET' && url.pathname.endsWith(id)) return route.fulfill({ json: { project } });
    if (route.request().method() === 'POST' && url.pathname.endsWith('/commands')) {
      const data = route.request().postDataJSON();
      project = {
        ...project,
        revision: project.revision + 1,
        deck: data.payload.deck,
      };
      return route.fulfill({
        json: {
          project,
          operation: { id: data.id, revision: project.revision },
        },
      });
    }
    if (route.request().method() === 'POST' && url.pathname.endsWith('/publish')) {
      project = {
        ...project,
        status: 'completed',
        stage: 'completed',
        error: '',
        quality: {
          ...project.quality,
          status: 'passed',
          deterministic: { issues: [], hardErrors: 0 },
        },
      };
      return route.fulfill({ json: { project } });
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.goto('/ppt', {waitUntil:'domcontentloaded'});await expect(page.getByText('加载中…',{exact:true})).toHaveCount(0);
  await page.getByRole('navigation',{name:'PPT 工作区导航'}).getByRole('button',{name:/任务中心/}).click();
  await page.getByTestId('ppt-task-center').locator('article').filter({hasText:'Needs repair'}).getByRole('button',{name:/查看任务/}).click();
  await page.getByRole('button', { name: '打开编辑器' }).click();
  await expect(
    page.locator('p').filter({
      hasText: /质量门禁已阻止发布。请修复上方问题后再次保存。|Publishing is blocked. Fix the listed issue and save again./,
    }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /导出 PPTX|Export PPTX/ })).toHaveCount(0);
  await page.getByRole('textbox', { name: /要点 1|Bullet points 1/ }).fill('Qualitative revenue evidence');
  await page.getByRole('button', { name: /保存页面|Save slides/ }).click();
  await expect(page.getByRole('link', { name: /导出 PPTX|Export PPTX/ })).toHaveAttribute('href', `/api/ppt/projects/${id}/export`);
});

test('PPT M4 visual blocks, undo, template switch and one-slide AI @smoke', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const id = 'd'.repeat(32);
  const now = new Date().toISOString();
  let project = {
    id,
    title: 'Rich deck',
    prompt: 'Facts',
    pages: 1,
    template: 'violet',
    templateSpec: {
      id: 'violet',
      name: 'Violet',
      version: 1,
      palette: {
        background: '#171b31',
        accent: '#967fff',
        foreground: '#f5f6fc',
        muted: '#c7cad8',
      },
      fonts: {
        title: 'Noto Sans CJK SC',
        body: 'Noto Sans CJK SC',
        titleEastAsia: 'Noto Sans CJK SC',
        bodyEastAsia: 'Noto Sans CJK SC',
        cjkExplicit: true,
      },
    },
    status: 'completed',
    stage: 'completed',
    error: '',
    outline: [{ id: '1', title: 'Opening', focus: 'Facts' }],
    deck: {
      slides: [
        {
          id: '1',
          title: 'Opening',
          bullets: ['Fact'],
          blocks: [] as unknown[],
          layoutId: 'summary',
        },
      ],
    },
    quality: {
      status: 'passed',
      deterministic: { issues: [], hardErrors: 0 },
      modelReview: {
        missing: [],
        repeated: [],
        conflicts: [],
        unsupported: [],
      },
      repairs: [],
    },
    revision: 1,
    favorite: false,
    pinned: false,
    folderId: null,
    tags: [],
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  let rewriteInput: Record<string, unknown> | null = null;
  await page.route('**/api/ppt/folders**', (route) => route.fulfill({ json: { folders: [] } }));
  await page.route('**/api/ppt/templates**', (route) =>
    route.fulfill({
      json: {
        templates: [
          {
            id: 'violet',
            name: 'Violet',
            compatibility: 'mapped',
            palette: null,
          },
          {
            id: 'light',
            name: 'Light',
            compatibility: 'mapped',
            palette: null,
          },
        ],
      },
    }),
  );
  await page.route('**/api/ppt/projects**', (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/ppt/projects')
      return route.fulfill({
        json: {
          projects: url.searchParams.get('trash') === '1' ? [] : [project],
        },
      });
    if (method === 'GET' && url.pathname.endsWith('/versions')) return route.fulfill({ json: { versions: [] } });
    if (method === 'GET' && url.pathname.endsWith(id)) return route.fulfill({ json: { project } });
    if (method === 'POST' && url.pathname.endsWith('/commands')) {
      const data = route.request().postDataJSON();
      project = {
        ...project,
        deck: data.payload.deck,
        revision: project.revision + 1,
      };
      return route.fulfill({
        json: {
          project,
          operation: { id: data.id, revision: project.revision },
        },
      });
    }
    if (method === 'POST' && url.pathname.endsWith('/publish')) {
      return route.fulfill({ json: { project } });
    }
    if (method === 'PATCH' && url.pathname.endsWith(id)) {
      const data = route.request().postDataJSON();
      project = {
        ...project,
        template: data.template || project.template,
        revision: project.revision + 1,
      };
      return route.fulfill({ json: { project } });
    }
    if (method === 'POST' && url.pathname.endsWith('/rewrite')) {
      rewriteInput = route.request().postDataJSON();
      project = {
        ...project,
        deck: {
          slides: project.deck.slides.map((slide) =>
            rewriteInput?.blockId
              ? {
                  ...slide,
                  blocks: slide.blocks.map((block) => ((block as { id: string }).id === rewriteInput?.blockId ? { ...(block as object), text: 'Better label' } : block)),
                }
              : { ...slide, title: 'AI revised' },
          ),
        },
        revision: project.revision + 1,
      };
      return route.fulfill({ json: { project } });
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.goto('/ppt', {waitUntil:'domcontentloaded'});await expect(page.getByText('加载中…',{exact:true})).toHaveCount(0);
  await page
    .getByRole('button', { name: /Rich deck/ })
    .first()
    .click();
  await page.getByRole('button', { name: '打开编辑器' }).click();
  await expect(page.getByTestId('ppt-quality-report')).toContainText(/质量门禁|Quality gate/);
  await expect(page.getByText(/Noto Sans CJK SC \/ Noto Sans CJK SC/)).toBeVisible();
  await selectPptOption(page.getByRole('combobox', { name: /页面排版|Slide layout/ }), 'comparison');
  await expect(page.locator('[data-layout="comparison"]')).toBeVisible();
  await page.getByRole('button', { name: /图表|Chart/ }).click();
  await page.getByRole('textbox', { name: /数值|Values/ }).fill('4, 7');
  await page.getByRole('button', { name: /撤销|Undo/ }).click();
  await expect(page.getByRole('textbox', { name: /数值|Values/ })).toHaveValue('1, 2');
  await page.getByRole('button', { name: /重做|Redo/ }).click();
  if (process.env.PPT_M4_CAPTURE) {
    await page.screenshot({
      path: '/tmp/codepilot-ppt-m4-desktop.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: '/tmp/codepilot-ppt-m4-mobile.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await page.getByRole('button', { name: /保存页面|Save slides/ }).click();
  await expect.poll(() => (project.deck.slides[0].blocks[0] as { values: number[] }).values).toEqual([4, 7]);
  await selectPptOption(page.getByRole('combobox', { name: /切换模板|Switch template/ }), 'light');
  await expect.poll(() => project.template).toBe('light');
  await page.getByRole('textbox', { name: /用 AI 改写本页|Rewrite this slide with AI/ }).fill('Shorten the title');
  await page.getByRole('button', { name: /改写本页|Rewrite slide/ }).click();
  await expect(page.getByRole('textbox', { name: /页面标题 1|Slide title 1/ })).toHaveValue('AI revised');
  expect(rewriteInput).toMatchObject({
    slideId: '1',
    instruction: 'Shorten the title',
  });
  await page.getByRole('button', { name: /形状|Shape/ }).click();
  await page.getByRole('button', { name: /保存页面|Save slides/ }).click();
  await page.getByRole('textbox', { name: /用 AI 改写本页|Rewrite this slide with AI/ }).fill('Make this label clearer');
  await page.getByRole('button', { name: /改写文字|Rewrite label/ }).click();
  await expect(page.locator('input[value="Better label"]')).toBeVisible();
  expect(rewriteInput).toMatchObject({ blockId: expect.any(String) });
  expect(pageErrors).toEqual([]);
});

test('PPT M1 creation, outline approval, editing and export entry @smoke', async ({ page }) => {
  await page.route('**/api/ppt/page-estimate',route=>route.fulfill({json:{recommendation:{recommended:6,min:3,max:12,reason:'Deterministic mocked planning capacity'}}}));
  await page.route('**/api/ppt/templates**', route => route.fulfill({ json: { templates: [{ id: 'violet', name: 'Default', kind: 'built-in', compatibility: 'mapped', pages: 8, sampleTitles: ['Cover'] }] } }));
  const id = 'a'.repeat(32);
  let project: Record<string, unknown> | null = null;
  let generateCalls = 0;
  await page.route('**/api/ppt/folders**', (route) => route.fulfill({ json: { folders: [] } }));
  await page.route('**/api/providers/models', (route) =>
    route.fulfill({
      json: {
        groups: [
          {
            provider_id: 'managed-local-id',
            models: [{ value: 'demo-model', label: 'Demo model' }],
          },
        ],
      },
    }),
  );
  await page.route('**/api/providers', (route) =>
    route.fulfill({
      json: {
    providers: [{ id: 'managed-local-id', name: 'Test model', source: 'managed', managed_config_id: 'server-config-42' }],
      },
    }),
  );
  await page.route('**/api/ppt/projects**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const action = url.pathname.split('/').at(-1);
    if (method === 'GET' && url.pathname === '/api/ppt/projects') return route.fulfill({ json: { projects: project ? [project] : [] } });
    if (method === 'POST' && url.pathname === '/api/ppt/projects') {
      const body = route.request().postDataJSON();
      expect(body.configId).toBe('server-config-42');
      expect(body.model).toBe('demo-model');
      project = {
        id,
        title: body.title || body.prompt.slice(0, 60),
        prompt: body.prompt,
        pages: body.pages ?? 6,
        template: body.template,
        status: 'outline_ready',
        stage: 'outline',
        error: '',
        outline: Array.from({ length: body.pages ?? 6 }, (_, i) => ({
          id: String(i + 1),
          title: `Slide ${i + 1}`,
          focus: `Focus ${i + 1}`,
        })),
        deck: null,
        revision: 0,
        updatedAt: new Date().toISOString(),
      };
      return route.fulfill({ status: 201, json: { project } });
    }
    if (method === 'PATCH' && action === 'outline') {
      project = { ...project, outline: route.request().postDataJSON().slides };
      return route.fulfill({ json: { project } });
    }
    if (method === 'POST' && action === 'generate') {
      generateCalls++;
      const slides = (project!.outline as Array<{ id: string; title: string }>).map((s) => ({ id: s.id, title: s.title, bullets: ['First point'] }));
      project = {
        ...project,
        status: 'completed',
        stage: 'completed',
        revision: 1,
        deck: { slides },
      };
      return route.fulfill({ status: 202, json: { project } });
    }
    if (method === 'POST' && action === 'commands') {
      const body = route.request().postDataJSON();
      project = { ...project, deck: body.payload.deck, revision: 2 };
      return route.fulfill({
        json: { project, operation: { id: body.id, revision: 2 } },
      });
    }
    if (method === 'POST' && action === 'publish') {
      project = { ...project, publishedRevision: 2 };
      return route.fulfill({ json: { project } });
    }
    if (method === 'GET' && action === id) return route.fulfill({ json: { project } });
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });

  await page.goto('/ppt', {waitUntil:'domcontentloaded'});await expect(page.getByText('加载中…',{exact:true})).toHaveCount(0);
  await page
    .getByRole('button', { name: /＋ 新建|新建 PPT/ })
    .first()
    .click();
  await page.getByRole('button', { name: /从 Prompt 开始/ }).click();
  await selectPptOption(page.getByRole('combobox', { name: 'LLM（必填）' }), 'managed-local-id::demo-model');
  await page.getByRole('button', { name: '确认并继续 →' }).click();
  await page.getByRole('button', { name: /Default/ }).click();
  await page.getByRole('button', { name: '下一步：输入内容 →' }).click();
  await page.getByRole('textbox', { name: '输入 Prompt' }).fill('Quarterly business review for management');
  await page.getByText('当前解析模型').waitFor();
  await page.getByRole('button', { name: '读取输入并生成大纲' }).click();
  await expect(page.getByTestId('ppt-outline-review')).toBeVisible();
  await expect(page.getByText('Syllabus（大纲）')).toBeVisible();
  await expect(page.getByTestId('ppt-outline-auto-continue')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('outline-explicit-confirmation.png') });
  await page.waitForTimeout(1500);expect(generateCalls).toBe(0);
  await page.getByRole('button', { name: '确认大纲并生成页面' }).click();
  await page.getByRole('button', { name: '打开编辑器' }).click();
  await expect(page.getByRole('link', { name: /导出 PPTX|Export PPTX/ })).toHaveAttribute('href', `/api/ppt/projects/${id}/export`);
  await page.getByRole('textbox', { name: /要点 2|Bullet points 2/ }).fill('Revised point');
  await page.getByRole('button', { name: /保存页面|Save slides/ }).click();
  await expect(page.getByRole('textbox', { name: /要点 2|Bullet points 2/ })).toHaveValue('Revised point');
});

test('PPT structured editor persists object commands, history, AI edits and publish @smoke', async ({ page }) => {
  const id = '7'.repeat(32);
  const slideId = 'slide_demo';
  const nodeId = 'node_title';
  const slideTwoId = 'slide_two';
  const nodeTwoId = 'node_two_title';
  const now = new Date().toISOString();
  const bounds = { x: 800000, y: 700000, width: 10500000, height: 1200000 };
  let content = 'Stable object title';
  let contentTwo = 'Second slide title';
  let revision = 3;
  let publishedRevision = 2;
  let savedContent = content;
  let lastPayload: Record<string, unknown> = {};
  const operations: Array<Record<string, unknown>> = [];
  const makeProject = () => ({
    id,
    title: 'Structured deck',
    prompt: 'Architecture',
    pages: 2,
    template: 'light',
    status: 'completed',
    stage: 'completed',
    error: '',
    outline: [
      { id: slideId, title: content },
      { id: slideTwoId, title: contentTwo },
    ],
    deck: {
      schemaVersion: 3,
      deckId: 'deck_demo',
      slides: [
        {
          id: slideId,
          title: content,
          bullets: [],
          blocks: [],
          nodes: [
            {
              id: nodeId,
              type: 'text',
              semanticRole: 'title',
              content: { text: content },
              geometry: bounds,
              style: { fontSizePt: 30 },
            },
          ],
        },
        {
          id: slideTwoId,
          title: contentTwo,
          bullets: [],
          blocks: [],
          nodes: [
            {
              id: nodeTwoId,
              type: 'text',
              semanticRole: 'title',
              content: { text: contentTwo },
              geometry: bounds,
              style: { fontSizePt: 30 },
            },
          ],
        },
      ],
    },
    renderTree: {
      schemaVersion: 1,
      units: 'emu',
      deckId: 'deck_demo',
      hash: `r${revision}`,
      size: { width: 12192000, height: 6858000 },
      slides: [
        {
          id: slideId,
          slideId,
          index: 0,
          layoutId: 'summary',
          size: { width: 12192000, height: 6858000 },
          background: '#ffffff',
          elements: [
            {
              id: nodeId,
              nodeId,
              kind: 'text',
              bounds,
              content: { text: content },
              style: { color: '#111111', fontFamily: 'Arial', fontSizePt: 30 },
              zIndex: 1,
            },
          ],
        },
        {
          id: slideTwoId,
          slideId: slideTwoId,
          index: 1,
          layoutId: 'summary',
          size: { width: 12192000, height: 6858000 },
          background: '#ffffff',
          elements: [
            {
              id: nodeTwoId,
              nodeId: nodeTwoId,
              kind: 'text',
              bounds,
              content: { text: contentTwo },
              style: { color: '#111111', fontFamily: 'Arial', fontSizePt: 30 },
              zIndex: 1,
            },
          ],
        },
      ],
    },
    quality: {
      status: 'passed',
      deterministic: { issues: [], hardErrors: 0 },
      modelReview: {
        missing: [],
        repeated: [],
        conflicts: [],
        unsupported: [],
      },
      repairs: [],
    },
    revision,
    draftRevision: revision,
    publishedRevision,
    favorite: false,
    pinned: false,
    folderId: null,
    tags: [],
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await page.route('**/api/ppt/folders**', (route) => route.fulfill({ json: { folders: [] } }));
  await page.route('**/api/ppt/templates**', (route) =>
    route.fulfill({
      json: {
        templates: [
          {
            id: 'light',
            name: 'Light',
            compatibility: 'mapped',
            palette: null,
          },
        ],
      },
    }),
  );
  await page.route('**/api/ppt/projects**', (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/ppt/projects') return route.fulfill({ json: { projects: [makeProject()] } });
    if (method === 'GET' && url.pathname.endsWith('/commands')) return route.fulfill({ json: { operations } });
    if (method === 'POST' && url.pathname.endsWith('/commands')) {
      const command = route.request().postDataJSON();
      lastPayload = command.payload;
      if (command.type === 'node.setContent' && command.payload.slideId === slideId) content = command.payload.content.text;
      if (command.type === 'node.setContent' && command.payload.slideId === slideTwoId) contentTwo = command.payload.content.text;
      if (command.type === 'ai.objectPatch') content = command.payload.patch.content.text;
      revision += 1;
      operations.push({
        id: command.id,
        kind: 'command',
        revision,
        command: { type: command.type },
        at: now,
      });
      return route.fulfill({
        json: { project: makeProject(), operation: operations.at(-1) },
      });
    }
    if (method === 'POST' && url.pathname.endsWith('/ai-edit'))
      return route.fulfill({ json: { proposal: {
        id: 'proposal_fixture', scope: 'object', slideId, nodeId, baseRevision: revision,
        before: { text: content }, content: { text: 'AI focused title' },
        beforeSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><text x="20" y="30">Original</text></svg>',
        afterSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><text x="20" y="30">AI focused title</text></svg>',
        quality: { issues: [], hardErrors: 0 },
      } } });
    if (method === 'POST' && url.pathname.endsWith('/proposals/proposal_fixture/apply')) {
      content = 'AI focused title'; revision += 1;
      operations.push({ id: 'proposal_fixture', kind: 'command', revision, command: { type: 'ai.objectPatch' }, at: now });
      return route.fulfill({ json: { project: makeProject(), operation: operations.at(-1) } });
    }
    if (method === 'POST' && url.pathname.endsWith('/proposals/proposal_fixture/discard')) return route.fulfill({ json: { proposal: { status: 'discarded' } } });
    if (method === 'POST' && url.pathname.endsWith('/undo')) {
      revision += 1;
      content = 'Stable object title';
      return route.fulfill({ json: { project: makeProject() } });
    }
    if (method === 'POST' && url.pathname.endsWith('/redo')) {
      revision += 1;
      content = 'Edited object title';
      return route.fulfill({ json: { project: makeProject() } });
    }
    if (method === 'POST' && url.pathname.endsWith('/publish')) {
      publishedRevision = revision;
      savedContent = content;
      return route.fulfill({ json: { project: makeProject(), published: true } });
    }
    if (method === 'POST' && /\/revisions\/\d+\/restore$/.test(url.pathname)) {
      content = savedContent;
      revision += 1;
      return route.fulfill({ json: { project: makeProject() } });
    }
    if (method === 'GET' && url.pathname.endsWith(id)) return route.fulfill({ json: { project: makeProject() } });
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.goto('/ppt', {waitUntil:'domcontentloaded'});await expect(page.getByText('加载中…',{exact:true})).toHaveCount(0);
  await page
    .getByRole('button', { name: /Structured deck/ })
    .first()
    .click();
  await page.getByRole('button', { name: '打开编辑器' }).click();
  await expect(page.getByTestId('ppt-structured-editor')).toBeVisible();
  await page.getByRole('button', { name: '返回工作区' }).click();
  await expect(page.getByRole('dialog', { name: '是否保留改动？' })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  if (process.env.PPT_EDITOR_CAPTURE) {
    await page.screenshot({ path: '/tmp/aimate-ppt-editor-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('ppt-structured-editor')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/aimate-ppt-editor-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await page.locator(`[data-node-id="${nodeId}"]`).click();
  await page.getByRole('button', { name: '文本格式' }).click();
  await page.getByRole('textbox', { name: /Properties|属性|屬性/ }).fill('Edited object title');
  await page.getByRole('button', { name: /Apply content|应用内容|應用內容/ }).click();
  await expect(page.locator(`[data-node-id="${nodeId}"]`)).toContainText('Edited object title');
  await page
    .getByRole('complementary')
    .filter({ hasText: /文本格式|Text format|文字格式/ })
    .getByRole('button', { name: /关闭|Close|關閉/, exact: true })
    .click();
  await page.locator(`[data-node-id="${nodeTwoId}"]`).dispatchEvent('dblclick');
  await page.locator(`[data-node-id="${nodeTwoId}"] textarea`).fill('Edited second slide');
  await page.locator(`[data-node-id="${nodeTwoId}"] textarea`).press('Tab');
  await expect.poll(() => lastPayload.slideId).toBe(slideTwoId);
  expect(lastPayload.nodeId).toBe(nodeTwoId);
  await expect(page.locator(`[data-node-id="${nodeTwoId}"]`)).toContainText('Edited second slide');
  await page.locator(`[data-node-id="${nodeId}"]`).click();
  await page.getByRole('button', { name: 'AI 润色', exact: true }).click();
  await page.getByRole('textbox', { name: '编辑要求' }).fill('Make it more focused');
  await page.getByRole('button', { name: '预览所选对象修改' }).click();
  await expect(page.getByTestId('ppt-ai-comparison')).toBeVisible();
  await expect(page.getByRole('img', { name: '候选页面' })).toBeVisible();
  await page.getByRole('button', { name: '应用修改' }).click();
  await expect(page.locator(`[data-node-id="${nodeId}"]`)).toContainText('AI focused title');
  await page.getByText('撤销、重做与命令记录').click();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.getByText(/Edit history|编辑历史|編輯歷史/).click();
  await expect(page.getByText(/node.setContent/).first()).toBeVisible();
  await page
    .getByRole('complementary')
    .filter({ hasText: /AI 润色|AI edit|AI 潤飾/ })
    .getByRole('button', { name: /关闭|Close|關閉/, exact: true })
    .click();
  await page.getByRole('button', { name: '✓ 保存' }).click();
  expect(publishedRevision).toBe(revision);
  await page.locator(`[data-node-id="${nodeId}"]`).click();
  await page.getByRole('button', { name: '文本格式' }).click();
  await page.getByRole('textbox', { name: /Properties|属性|屬性/ }).fill('Discard this title');
  await page.getByRole('button', { name: /Apply content|应用内容|應用內容/ }).click();
  await page.getByRole('complementary').filter({ hasText: /文本格式|Text format|文字格式/ })
    .getByRole('button', { name: /关闭|Close|關閉/, exact: true }).click();
  await page.getByRole('button', { name: '返回工作区' }).click();
  await page.getByRole('button', { name: '不保留并退出' }).click();
  await expect(page.getByRole('button', { name: '打开编辑器' })).toBeVisible();
  expect(content).toBe(savedContent);
});

test('PPT M2 library folders, favorites, search and trash @smoke', async ({ page }) => {
  const id = 'b'.repeat(32);
  const folderId = 'c'.repeat(32);
  const now = new Date().toISOString();
  const folders: Array<{
    id: string;
    name: string;
    count: number;
    pinned: boolean;
  }> = [];
  let item = {
    id,
    title: 'Quarterly plan',
    prompt: 'plan',
    pages: 3,
    template: 'violet',
    status: 'completed',
    stage: 'completed',
    error: '',
    outline: [{ id: '1', title: 'Opening' }],
    deck: { slides: [{ id: '1', title: 'Opening', bullets: [] }] },
    revision: 1,
    favorite: false,
    pinned: false,
    folderId: null as string | null,
    tags: [],
    deletedAt: null as string | null,
    createdAt: now,
    updatedAt: now,
  };
  await page.route('**/api/ppt/folders**', (route) => {
    const method = route.request().method();
    if (method === 'GET') return route.fulfill({ json: { folders } });
    if (method === 'POST') {
      folders.push({
        id: folderId,
        name: route.request().postDataJSON().name,
        count: 0,
        pinned: false,
      });
      return route.fulfill({ status: 201, json: { folder: folders[0] } });
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.route('**/api/ppt/projects**', (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/ppt/projects')
      return route.fulfill({
        json: {
          projects: (item.deletedAt === null && url.searchParams.get('trash') !== '1') || (item.deletedAt !== null && url.searchParams.get('trash') === '1') ? [item] : [],
        },
      });
    if (method === 'POST' && url.pathname.endsWith('/bulk')) {
      if (route.request().postDataJSON().action === 'restore') item.deletedAt = null;
      return route.fulfill({ json: { ok: true, count: 1 } });
    }
    if (method === 'PATCH' && url.pathname.endsWith(id)) {
      item = { ...item, ...route.request().postDataJSON() };
      return route.fulfill({ json: { project: item } });
    }
    if (method === 'POST' && url.pathname.endsWith('/trash')) {
      item.deletedAt = now;
      return route.fulfill({ json: { project: item } });
    }
    if (method === 'POST' && url.pathname.endsWith('/restore')) {
      item.deletedAt = null;
      return route.fulfill({ json: { project: item } });
    }
    if (method === 'GET' && url.pathname.endsWith(id)) return route.fulfill({ json: { project: item } });
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.goto('/ppt', {waitUntil:'domcontentloaded'});await expect(page.getByText('加载中…',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Quarterly plan')).toBeVisible();
  await page.locator('article').filter({ hasText: 'Quarterly plan' }).getByRole('button', { name: '收藏', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'PPT 工作区导航' })
    .getByRole('button', { name: /收藏|Favorites/ })
    .click();
  await expect(page.getByText('Quarterly plan')).toBeVisible();
  await page.getByRole('textbox', { name: '搜索 PPT' }).fill('missing');
  await expect(page.getByText('Quarterly plan')).toHaveCount(0);
  await page.getByRole('textbox', { name: '搜索 PPT' }).fill('Quarterly');
  await page.getByRole('button', { name: /新建文件夹|Create folder/ }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Marketing');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /确认|Confirm/ })
    .click();
  await expect(page.getByRole('button', { name: /Marketing \(0\)/ })).toBeVisible();
  await page.getByRole('button', { name: /更多|More/ }).click();
  await page.getByRole('menuitem', { name: /移动文件夹/ }).click();
  await selectPptOption(page.getByRole('dialog').getByRole('combobox'), folderId);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /确认|Confirm/ })
    .click();
  await expect.poll(() => item.folderId).toBe(folderId);
  await page.getByRole('button', { name: /更多|More/ }).click();
  await page.getByRole('menuitem', { name: /删除项目/ }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /确认|Confirm/ })
    .click();
  await page.getByRole('button', { name: /回收站|Trash/ }).click();
  await expect(page.getByText('Quarterly plan')).toBeVisible();
  await page.getByTestId('ppt-project-card').filter({hasText:'Quarterly plan'}).hover();
  await page
    .getByRole('checkbox', {
      name: /选择 Quarterly plan|Select Quarterly plan/,
    })
    .check();
  await page
    .getByRole('button', { name: /恢复|Restore/ })
    .last()
    .click();
  await expect(page.getByText('Quarterly plan')).toHaveCount(0);
});

test('PPT M2 paste and file inputs reach source aware outlines @smoke', async ({ page }) => {
  await page.route('**/api/ppt/page-estimate',route=>route.fulfill({json:{recommendation:{recommended:6,min:3,max:12,reason:'Deterministic mocked planning capacity'}}}));
  await page.route('**/api/ppt/templates**', route => route.fulfill({ json: { templates: [{ id: 'violet', name: 'Default', kind: 'built-in', compatibility: 'mapped', pages: 8, sampleTitles: ['Cover'] }] } }));
  let created: Record<string, unknown> | null = null;
  const payloads: Record<string, unknown>[] = [];
  await page.route('**/api/providers/models', (route) =>
    route.fulfill({
      json: {
        groups: [
          {
            provider_id: 'managed-demo',
            models: [{ value: 'demo-model', label: 'Demo model' }],
          },
        ],
      },
    }),
  );
  await page.route('**/api/providers', (route) =>
    route.fulfill({
      json: {
        providers: [{ id: 'managed-demo', name: 'Test model', source: 'managed' }],
      },
    }),
  );
  await page.route('**/api/ppt/folders**', (route) => route.fulfill({ json: { folders: [] } }));
  await page.route('**/api/ppt/projects**', (route) => {
    const url = new URL(route.request().url());
    const action = url.pathname.split('/').at(-1);
    if (route.request().method() === 'GET' && url.pathname === '/api/ppt/projects')
      return route.fulfill({
        json: {
          projects: created && url.searchParams.get('trash') !== '1' ? [created] : [],
        },
      });
    if (route.request().method() === 'POST' && url.pathname === '/api/ppt/projects') {
      const body = route.request().postDataJSON();
      payloads.push(body);
      const id = String(payloads.length).repeat(32);
      created = {
        id,
        title: body.title || 'Imported notes',
        prompt: body.prompt || '',
        pages: 3,
        template: 'violet',
        status: 'outline_ready',
        stage: 'outline',
        error: '',
        inputKind: body.inputKind,
        source: {
          kind: body.inputKind,
          name: body.fileName || '粘贴文本',
          text: body.text || 'File facts',
          images: body.images || [],
          segments: [{ id: '1', location: '行 1', text: body.text || 'File facts' }],
        },
        outline: Array.from({ length: 3 }, (_, i) => ({
          id: String(i + 1),
          title: `Slide ${i + 1}`,
          focus: `Focus ${i + 1}`,
          refs: ['1'],
        })),
        deck: null,
        revision: 0,
        sourceRevision: 1,
        updatedAt: new Date().toISOString(),
      };
      return route.fulfill({ status: 201, json: { project: created } });
    }
    if (route.request().method() === 'PATCH' && action === 'outline' && created) {
      created = { ...created, outline: route.request().postDataJSON().slides };
      return route.fulfill({ json: { project: created } });
    }
    if (route.request().method() === 'POST' && action === 'generate' && created) {
      const outline = created.outline as Array<{ id: string; title: string }>;
      created = {
        ...created,
        status: 'completed',
        stage: 'completed',
        deck: { slides: outline.map((item) => ({ ...item, bullets: [] })) },
        revision: 1,
      };
      return route.fulfill({ status: 202, json: { project: created } });
    }
    if (route.request().method() === 'GET' && created && url.pathname.endsWith(String(created.id))) return route.fulfill({ json: { project: created } });
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.goto('/ppt', {waitUntil:'domcontentloaded'});await expect(page.getByText('加载中…',{exact:true})).toHaveCount(0);
  await page
    .getByRole('button', { name: /＋ 新建|新建 PPT/ })
    .first()
    .click();
  await page.getByRole('button', { name: /粘贴文本/ }).click();
  await selectPptOption(page.getByRole('combobox', { name: 'LLM（必填）' }), 'managed-demo::demo-model');
  await page.getByRole('button', { name: '确认并继续 →' }).click();
  await page.getByRole('button', { name: /Default/ }).click();
  await page.getByRole('button', { name: '下一步：输入内容 →' }).click();
  const pasteBox = page.getByRole('textbox', { name: '粘贴文本' });
  await pasteBox.fill('Revenue grew 10%');
  const screenshot = await page.screenshot();
  await pasteBox.evaluate(
    (element, bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(bytes)], 'dashboard.png', {
          type: 'image/png',
        }),
      );
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    [...screenshot],
  );
  await expect(page.getByAltText('dashboard')).toBeVisible();
  if (process.env.PPT_PASTE_CAPTURE) {
    await page.screenshot({
      path: '/tmp/codepilot-ppt-paste-images-desktop.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: '/tmp/codepilot-ppt-paste-images-mobile.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await page.getByRole('button', { name: '生成 Syllabus', exact:true }).click();
  await page.getByRole('button', { name: '确认大纲并生成页面' }).click();
  expect(payloads[0]).toMatchObject({
    inputKind: 'paste',
    text: 'Revenue grew 10%',
    images: [{ type: 'image', caption: 'dashboard' }],
  });
  await page.getByRole('button', { name: '关闭' }).click();
  await page
    .getByRole('button', { name: /＋ 新建|新建 PPT/ })
    .first()
    .click();
  await page.getByRole('button', { name: /导入文件/ }).click();
  await selectPptOption(page.getByRole('combobox', { name: 'LLM（必填）' }), 'managed-demo::demo-model');
  await page.getByRole('button', { name: '确认并继续 →' }).click();
  await page.getByRole('button', { name: /Default/ }).click();
  await page.getByRole('button', { name: '下一步：输入内容 →' }).click();
  const sourceFileInput = page.locator('input[type=file]');
  await expect(sourceFileInput).toHaveAttribute('accept', /\.xlsx.*\.csv|\.csv.*\.xlsx/);
  await sourceFileInput.setInputFiles({
    name: 'metrics.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('metric,value\nRevenue,10%'),
  });
  await page.getByRole('textbox', { name: '输入 Prompt' }).fill('提炼文件核心事实');
  await page.getByRole('button', { name: '生成 Syllabus', exact:true }).click();
  await page.getByRole('button', { name: '确认大纲并生成页面' }).click();
  await expect.poll(() => payloads.length).toBe(2);
  expect(payloads[1]).toMatchObject({
    inputKind: 'file',
    fileName: 'metrics.csv',
    fileBase64: Buffer.from('metric,value\nRevenue,10%').toString('base64'),
  });
});

test('PPTX fidelity import selects a model before opening the file @smoke', async ({ page }) => {
  let payload: Record<string, unknown> | null = null;
  const id = '6'.repeat(32);
  await page.route('**/api/providers/models', (route) => route.fulfill({ json: { groups: [{ provider_id: 'managed-demo', models: [{ value: 'demo-model', label: 'Demo model' }] }] } }));
  await page.route('**/api/providers', (route) => route.fulfill({ json: { providers: [{ id: 'managed-demo', name: 'Test model', source: 'managed' }] } }));
  await page.route('**/api/ppt/folders**', (route) => route.fulfill({ json: { folders: [] } }));
  await page.route('**/api/ppt/templates**', (route) => route.fulfill({ json: { templates: [{id:'light',name:'Default',kind:'built-in',compatibility:'mapped',pages:8,sampleTitles:['Cover']}] } }));
  await page.route('**/api/ppt/projects**', (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' && url.pathname === '/api/ppt/projects') return route.fulfill({ json: { projects: [] } });
    if (route.request().method() === 'POST' && url.pathname === '/api/ppt/projects') {
      payload = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: {
          project: {
            id,
            title: 'Imported',
            prompt: 'original.pptx',
            pages: 1,
            template: 'violet',
            status: 'completed',
            stage: 'completed',
            error: '',
            outline: [],
            deck: { slides: [] },
            revision: 1,
            updatedAt: new Date().toISOString(),
          },
        },
      });
    }
    if (route.request().method() === 'GET' && url.pathname.endsWith(id))
      return route.fulfill({
        json: {
          project: {
            id,
            title: 'Imported',
            pages: 1,
            status: 'completed',
            outline: [],
            deck: { slides: [] },
            revision: 1,
          },
        },
      });
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.goto('/ppt', {waitUntil:'domcontentloaded'});await expect(page.getByText('加载中…',{exact:true})).toHaveCount(0);
  await page.getByRole('button', { name: /↥ 导入|Import/ }).click();
  await selectPptOption(page.getByRole('combobox', { name: 'LLM（必填）' }), 'managed-demo::demo-model');
  await page.getByRole('button', { name: '确认并继续 →' }).click();
  await page.getByRole('button', { name: /Default/ }).click();
  await page.getByRole('button', { name: '下一步：输入内容 →' }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'original.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from('PKsample'),
  });
  await selectPptOption(page.getByRole('combobox', { name: /PPTX import mode|PPTX 导入方式/ }), 'editable');
  await page.getByRole('button', { name: /Open editable PPTX|打开并编辑 PPTX/ }).click();
  await expect.poll(() => payload).not.toBeNull();
  expect(payload).toMatchObject({
    importMode: 'editable',
    configId: 'demo',
    model: 'demo-model',
  });
});

test('PPT manual ordering persists and keeps pin groups separate @smoke', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const now = new Date().toISOString();
  const project = (id: string, title: string, pinned: boolean) => ({ id, title, pinned, favorite: false, manualOrder: 0,
    prompt: title, pages: 3, template: 'violet', status: 'completed', stage: 'completed', error: '', outline: [], deck: null,
    revision: 1, createdAt: now, updatedAt: now, tags: [], folderId: null });
  let projects = [project('a'.repeat(32), 'Pinned', true), project('b'.repeat(32), 'Regular A', false), project('c'.repeat(32), 'Regular B', false)];
  let folders = [{ id: 'd'.repeat(32), name: 'Folder A', count: 0, pinned: false, manualOrder: 0 },
    { id: 'e'.repeat(32), name: 'Folder B', count: 0, pinned: false, manualOrder: 1 }];
  let projectReorders = 0; let folderReorders = 0;
  await page.route('**/api/providers/models', route => route.fulfill({ json: { groups: [] } }));
  await page.route('**/api/providers', route => route.fulfill({ json: { providers: [] } }));
  await page.route('**/api/ppt/templates**', route => route.fulfill({ json: { templates: [] } }));
  await page.route('**/api/ppt/folders**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/order')) {
      const { movedId, targetId } = route.request().postDataJSON();
      folderReorders++;
      const moved = folders.find(row => row.id === movedId)!;
      folders = folders.filter(row => row.id !== movedId);
      folders.splice(folders.findIndex(row => row.id === targetId), 0, moved);
      folders = folders.map((row, index) => ({ ...row, manualOrder: index }));
      return route.fulfill({ json: { folders } });
    }
    return route.fulfill({ json: { folders } });
  });
  await page.route('**/api/ppt/projects**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/order')) {
      const { movedId, targetId } = route.request().postDataJSON();
      projectReorders++;
      const moved = projects.find(row => row.id === movedId)!;
      projects = projects.filter(row => row.id !== movedId);
      projects.splice(projects.findIndex(row => row.id === targetId), 0, moved);
      projects = projects.map((row, index) => ({ ...row, manualOrder: index }));
      return route.fulfill({ json: { order: projects.map(row => row.id) } });
    }
    return route.fulfill({ json: { projects: url.searchParams.get('trash') === '1' ? [] : projects } });
  });
  await page.goto('/ppt', {waitUntil:'domcontentloaded'});await expect(page.getByText('加载中…',{exact:true})).toHaveCount(0);
  await page.getByRole('button', { name: '▤ 全部 PPT (3)' }).click();
  await page.getByRole('button', { name: '拖动调整项目顺序 Regular B' }).dragTo(page.locator('article').filter({ hasText: 'Regular A' }));
  await expect.poll(() => projectReorders).toBe(1);
  await expect(page.getByRole('combobox', { name: '排序' })).toContainText('手动排序');
  await page.getByRole('button', { name: '拖动调整文件夹顺序 Folder B' }).dragTo(page.getByRole('button', { name: 'Folder A (0)' }));
  await expect.poll(() => folderReorders).toBe(1);
  await page.getByRole('button', { name: '拖动调整项目顺序 Regular A' }).dragTo(page.locator('article').filter({ hasText: 'Pinned' }));
  await expect.poll(() => projectReorders).toBe(1);
  await expect(page.getByRole('alert').first()).toContainText('置顶项目与普通项目不能互相排序');
});

test('PPT M3 template compatibility and version update workflow @smoke', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const baseId = 'e'.repeat(32);
  const updateId = 'f'.repeat(32);
  const customId = 'a'.repeat(32);
  const now = new Date().toISOString();
  const colors = {
    background: '#112233',
    accent: '#ddaa22',
    foreground: '#ffffff',
    muted: '#cccccc',
  };
  const builtIn = {
    id: 'violet',
    name: 'Violet',
    category: '商业汇报',
    description: 'Built in',
    pages: 10,
    kind: 'builtin',
    compatibility: 'mapped',
    pinned: false,
    tags: [],
    palette: colors,
  };
  const custom = {
    id: customId,
    name: 'Brand',
    category: '我的模板',
    description: 'Colors mapped',
    pages: 2,
    kind: 'uploaded',
    compatibility: 'mapped',
    pinned: false,
    tags: ['自定义'],
    palette: colors,
    sampleTitles: ['Brand title'],
  };
  const base = {
    id: baseId,
    title: 'Original plan',
    prompt: 'Original',
    pages: 3,
    template: 'violet',
    status: 'completed',
    stage: 'completed',
    error: '',
    outline: [{ id: '1', title: 'Old 1', focus: 'Old 1' }],
    deck: { slides: [{ id: '1', title: 'Old 1', bullets: ['Original fact'] }] },
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  let updated: Record<string, unknown> | null = null;
  const templates: Array<typeof builtIn | typeof custom> = [builtIn];
  let updatePayload: Record<string, unknown> | null = null;
  let outlinePatched = 0;
  let updateGenerated = 0;
  await page.route('**/api/providers/models', (route) =>
    route.fulfill({
      json: {
        groups: [
          {
            provider_id: 'managed-demo',
            models: [{ value: 'demo-model', label: 'Demo model' }],
          },
        ],
      },
    }),
  );
  await page.route('**/api/providers', (route) =>
    route.fulfill({
      json: {
        providers: [{ id: 'managed-demo', name: 'Test model', source: 'managed' }],
      },
    }),
  );
  await page.route('**/api/ppt/folders**', (route) => route.fulfill({ json: { folders: [] } }));
  await page.route('**/api/ppt/templates**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { templates } });
    if (route.request().method() === 'POST') {
      expect(new URL(route.request().url()).searchParams.get('fileName')).toBe('brand.pptx');
      expect(route.request().headers()['content-type']).toBe('application/octet-stream');
      expect(route.request().postDataBuffer()).toEqual(Buffer.from('PKsample'));
      templates.push(custom);
      return route.fulfill({ status: 201, json: { template: custom } });
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.route('**/api/ppt/updates', (route) => {
    updatePayload = route.request().postDataJSON();
    updated = {
      ...base,
      id: updateId,
      title: 'Original plan · 更新版',
      pages: updatePayload?.pages ?? 6,
      template: customId,
      templateSpec: {
        id: customId,
        name: 'Brand',
        version: 1,
        palette: colors,
      },
      status: 'outline_ready',
      stage: 'outline',
      inputKind: 'update',
      update: { baseSnapshot: { title: base.title, deck: base.deck } },
      version: { rootId: baseId, parentId: baseId, number: 2 },
      diff: { kept: 1, rewritten: 1, added: 4, removed: [] },
      source: {
        kind: 'update',
        name: 'Latest',
        text: 'Latest fact',
        segments: [{ id: 'U1', location: '进展', text: 'Latest fact' }],
      },
      outline: Array.from({ length: Number(updatePayload?.pages ?? 6) }, (_, i) => ({
        id: String(i + 1),
        title: `Updated ${i + 1}`,
        focus: 'Latest',
        section: 'Section',
        refs: ['U1'],
        baseSlideId: i === 0 ? '1' : null,
        change: i === 0 ? 'keep' : 'add',
      })),
      deck: null,
    };
    return route.fulfill({ status: 201, json: { project: updated } });
  });
  await page.route('**/api/ppt/projects**', (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname.endsWith('/versions'))
      return route.fulfill({
        json: {
          versions: [
            { id: baseId, title: base.title, number: 1, status: 'completed' },
            ...(updated
              ? [
                  {
                    id: updateId,
                    title: String(updated.title),
                    number: 2,
                    status: 'outline_ready',
                  },
                ]
              : []),
          ],
        },
      });
    if (method === 'PATCH' && url.pathname.endsWith('/outline') && updated) {
      outlinePatched += 1;
      updated = { ...updated, outline: route.request().postDataJSON().slides };
      return route.fulfill({ json: { project: updated } });
    }
    if (method === 'POST' && url.pathname.endsWith('/generate') && updated) {
      updateGenerated += 1;
      updated = {
        ...updated,
        status: 'generating',
        stage: 'content',
        nodes: {},
      };
      return route.fulfill({ status: 202, json: { project: updated } });
    }
    if (url.pathname.endsWith(baseId)) return route.fulfill({ json: { project: base } });
    if (url.pathname.endsWith(updateId)) return route.fulfill({ json: { project: updated } });
    return route.fulfill({
      json: {
        projects: url.searchParams.get('trash') === '1' ? [] : updated ? [base, updated] : [base],
      },
    });
  });
  await page.goto('/ppt', {waitUntil:'domcontentloaded'});await expect(page.getByText('加载中…',{exact:true})).toHaveCount(0);
  await page.getByText('Original plan', { exact: true }).waitFor();
  await page.waitForTimeout(500);
  await page
    .getByRole('navigation', { name: 'PPT 工作区导航' })
    .getByRole('button', { name: /模板中心/ })
    .click();
  await expect(page.getByRole('heading', { name: '模板中心' })).toBeVisible();
  await page.getByRole('button', { name: /上传模板/ }).click();
  await page
    .getByRole('dialog')
    .locator('input[type=file]')
    .setInputFiles({
      name: 'brand.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      buffer: Buffer.from('PKsample'),
    });
  await page.getByRole('dialog').getByRole('button', { name: '上传模板' }).click();
  await expect(page.getByText('Brand', { exact: true })).toBeVisible();
  if (process.env.PPT_M3_CAPTURE)
    await page.screenshot({
      path: '/tmp/codepilot-ppt-m3-templates-desktop.png',
      fullPage: true,
    });
  await page
    .getByRole('button', { name: /预览|Preview/ })
    .last()
    .click();
  await expect(page.getByRole('dialog')).toContainText('Brand');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '选择 LLM 并继续' })
    .click();
  await page.getByRole('button', { name: /从 Prompt 开始/ }).click();
  await selectPptOption(page.getByRole('combobox', { name: 'LLM（必填）' }), 'managed-demo::demo-model');
  await page.getByRole('button', { name: '确认并继续 →' }).click();
  await expect(page.getByTestId('ppt-template-browser')).toContainText('Brand');
  // Next.js dev indicator overlays the bottom-left footer; exercise its keyboard action.
  await page.getByRole('button', { name: '取消', exact:true }).press('Enter');
  await page.getByRole('button', { name: /▣ 最近使用/ }).click();
  await page
    .getByRole('button', {
      name: /基于上一版更新|Update from previous version/,
    })
    .click();
  await selectPptOption(page.getByRole('combobox', { name: 'LLM（必填）' }), 'managed-demo::demo-model');
  await page.getByRole('button', { name: '确认并继续 →' }).click();
  await expect(page.locator('input[type=file]')).toHaveAttribute('accept', /\.xlsx.*\.csv|\.csv.*\.xlsx/);
  await page.getByRole('button', { name: '上传文件' }).click();
  await expect(page.locator('input[type=file]').last()).toHaveAttribute('accept', /\.xlsx.*\.csv|\.csv.*\.xlsx/);
  await page.getByRole('button', { name: 'Prompt' }).click();
  await page.getByRole('button', { name: /Original plan/ }).click();
  await page.getByRole('textbox', { name: 'Prompt' }).fill('Latest fact');
  await page.getByRole('button', { name: /下一步：选择模板与页数/ }).click();
  await page.getByRole('button', { name: /Brand/ }).last().click();
  for (let i = 0; i < 5; i += 1) await page.getByRole('button', { name: '＋' }).click();
  await expect(page.getByText('11 页', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: /PPT 标题（可选）/ }).fill('New report title');
  await page.getByRole('button', { name: /下一步：确认大纲/ }).click();
  await expect(page.getByRole('textbox', { name: /更新大纲标题/ })).toHaveCount(11);
  await expect(page.getByRole('button', { name: '确认大纲并生成页面' })).toBeVisible();
  expect(outlinePatched).toBe(0);
  expect(updateGenerated).toBe(0);
  await page.getByRole('button', { name: '确认大纲并生成页面' }).click();
  await expect(page.getByTestId('ppt-generation-monitor')).toBeVisible();
  expect(outlinePatched).toBe(1);
  expect(updateGenerated).toBe(1);
  expect(updatePayload).toMatchObject({
    baseProjectId: baseId,
    progressKind: 'prompt',
    progressText: 'Latest fact',
    template: customId,
    pages: 11,
    title: 'New report title',
    configId: 'demo',
  });
  if (process.env.PPT_M3_CAPTURE) {
    await page.screenshot({
      path: '/tmp/codepilot-ppt-m3-update-desktop.png',
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: '/tmp/codepilot-ppt-m3-update-mobile.png',
      fullPage: true,
    });
  }
  expect(pageErrors).toEqual([]);
});
