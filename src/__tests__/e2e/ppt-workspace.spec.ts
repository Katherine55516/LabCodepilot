import { test, expect } from '@playwright/test';

test('PPT M5 blocked quality gate stays editable and publishes only after repair @smoke', async ({ page }) => {
  const id = '9'.repeat(32);
  const now = new Date().toISOString();
  let project = { id, title: 'Needs repair', prompt: 'Evidence review', pages: 1, template: 'light',
    templateSpec: { id: 'light', name: 'Light', version: 1, palette: { background: '#ffffff', accent: '#7657e8', foreground: '#1f2937', muted: '#4b5563' }, fonts: { title: 'Noto Serif CJK SC', body: 'Noto Sans CJK SC', titleEastAsia: 'Noto Serif CJK SC', bodyEastAsia: 'Noto Sans CJK SC', cjkExplicit: true } },
    status: 'quality_blocked', stage: 'repair', error: 'PPT quality gate blocked publish: missing source',
    outline: [{ id: '1', title: 'Evidence', focus: 'Evidence', refs: [] }], deck: { slides: [{ id: '1', title: 'Evidence', bullets: ['Revenue 42'], blocks: [] as unknown[], layoutId: 'summary' }] },
    quality: { status: 'blocked', deterministic: { issues: [{ code: 'numeric_source', severity: 'error', message: 'missing source' }], hardErrors: 1 }, modelReview: { missing: [], repeated: [], conflicts: [], unsupported: [] }, repairs: [] },
    revision: 0, favorite: false, pinned: false, folderId: null, tags: [], deletedAt: null, createdAt: now, updatedAt: now };
  await page.route('**/api/ppt/folders**', route => route.fulfill({ json: { folders: [] } }));
  await page.route('**/api/ppt/templates**', route => route.fulfill({ json: { templates: [{ id: 'light', name: 'Light', compatibility: 'mapped', palette: project.templateSpec.palette }] } }));
  await page.route('**/api/ppt/projects**', route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' && url.pathname === '/api/ppt/projects') return route.fulfill({ json: { projects: [project] } });
    if (route.request().method() === 'GET' && url.pathname.endsWith(id)) return route.fulfill({ json: { project } });
    if (route.request().method() === 'POST' && url.pathname.endsWith('/commands')) {
      const data = route.request().postDataJSON();
      project = { ...project, revision: project.revision + 1, deck: data.payload.deck };
      return route.fulfill({ json: { project, operation: { id: data.id, revision: project.revision } } });
    }
    if (route.request().method() === 'POST' && url.pathname.endsWith('/publish')) {
      project = { ...project, status: 'completed', stage: 'completed', error: '',
        quality: { ...project.quality, status: 'passed', deterministic: { issues: [], hardErrors: 0 } } };
      return route.fulfill({ json: { project } });
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.goto('/ppt');
  await page.getByRole('button', { name: /Needs repair/ }).first().click();
  await expect(page.locator('p').filter({ hasText: /质量门禁已阻止发布。请修复上方问题后再次保存。|Publishing is blocked. Fix the listed issue and save again./ })).toBeVisible();
  await expect(page.getByRole('link', { name: /导出 PPTX|Export PPTX/ })).toHaveCount(0);
  await page.getByRole('textbox', { name: /要点 1|Bullet points 1/ }).fill('Qualitative revenue evidence');
  await page.getByRole('button', { name: /保存页面|Save slides/ }).click();
  await expect(page.getByRole('link', { name: /导出 PPTX|Export PPTX/ })).toHaveAttribute('href', `/api/ppt/projects/${id}/export`);
});

test('PPT M4 visual blocks, undo, template switch and one-slide AI @smoke', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const id = 'd'.repeat(32);
  const now = new Date().toISOString();
  let project = { id, title: 'Rich deck', prompt: 'Facts', pages: 1, template: 'violet', templateSpec: { id: 'violet', name: 'Violet', version: 1, palette: { background: '#171b31', accent: '#967fff', foreground: '#f5f6fc', muted: '#c7cad8' }, fonts: { title: 'Noto Sans CJK SC', body: 'Noto Sans CJK SC', titleEastAsia: 'Noto Sans CJK SC', bodyEastAsia: 'Noto Sans CJK SC', cjkExplicit: true } }, status: 'completed', stage: 'completed', error: '',
    outline: [{ id: '1', title: 'Opening', focus: 'Facts' }], deck: { slides: [{ id: '1', title: 'Opening', bullets: ['Fact'], blocks: [] as unknown[], layoutId: 'summary' }] },
    quality: { status: 'passed', deterministic: { issues: [], hardErrors: 0 }, modelReview: { missing: [], repeated: [], conflicts: [], unsupported: [] }, repairs: [] },
    revision: 1, favorite: false, pinned: false, folderId: null, tags: [], deletedAt: null, createdAt: now, updatedAt: now };
  let rewriteInput: Record<string, unknown> | null = null;
  await page.route('**/api/ppt/folders**', route => route.fulfill({ json: { folders: [] } }));
  await page.route('**/api/ppt/templates**', route => route.fulfill({ json: { templates: [
    { id: 'violet', name: 'Violet', compatibility: 'mapped', palette: null },
    { id: 'light', name: 'Light', compatibility: 'mapped', palette: null },
  ] } }));
  await page.route('**/api/ppt/projects**', route => {
    const url = new URL(route.request().url()); const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/ppt/projects') return route.fulfill({ json: { projects: url.searchParams.get('trash') === '1' ? [] : [project] } });
    if (method === 'GET' && url.pathname.endsWith('/versions')) return route.fulfill({ json: { versions: [] } });
    if (method === 'GET' && url.pathname.endsWith(id)) return route.fulfill({ json: { project } });
    if (method === 'POST' && url.pathname.endsWith('/commands')) {
      const data = route.request().postDataJSON();
      project = { ...project, deck: data.payload.deck, revision: project.revision + 1 };
      return route.fulfill({ json: { project, operation: { id: data.id, revision: project.revision } } });
    }
    if (method === 'POST' && url.pathname.endsWith('/publish')) {
      return route.fulfill({ json: { project } });
    }
    if (method === 'PATCH' && url.pathname.endsWith(id)) {
      const data = route.request().postDataJSON();
      project = { ...project, template: data.template || project.template, revision: project.revision + 1 };
      return route.fulfill({ json: { project } });
    }
    if (method === 'POST' && url.pathname.endsWith('/rewrite')) {
      rewriteInput = route.request().postDataJSON();
      project = { ...project, deck: { slides: project.deck.slides.map(slide => rewriteInput?.blockId
        ? { ...slide, blocks: slide.blocks.map(block => (block as { id: string }).id === rewriteInput?.blockId ? { ...(block as object), text: 'Better label' } : block) }
        : { ...slide, title: 'AI revised' }) }, revision: project.revision + 1 };
      return route.fulfill({ json: { project } });
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.goto('/ppt');
  await page.getByRole('button', { name: /Rich deck/ }).first().click();
  await expect(page.getByTestId('ppt-quality-report')).toContainText(/质量门禁|Quality gate/);
  await expect(page.getByText(/Noto Sans CJK SC \/ Noto Sans CJK SC/)).toBeVisible();
  await page.getByRole('combobox', { name: /页面排版|Slide layout/ }).selectOption('comparison');
  await expect(page.locator('[data-layout="comparison"]')).toBeVisible();
  await page.getByRole('button', { name: /图表|Chart/ }).click();
  await page.getByRole('textbox', { name: /数值|Values/ }).fill('4, 7');
  await page.getByRole('button', { name: /撤销|Undo/ }).click();
  await expect(page.getByRole('textbox', { name: /数值|Values/ })).toHaveValue('1, 2');
  await page.getByRole('button', { name: /重做|Redo/ }).click();
  if (process.env.PPT_M4_CAPTURE) {
    await page.screenshot({ path: '/tmp/codepilot-ppt-m4-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '/tmp/codepilot-ppt-m4-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await page.getByRole('button', { name: /保存页面|Save slides/ }).click();
  await expect.poll(() => (project.deck.slides[0].blocks[0] as { values: number[] }).values).toEqual([4, 7]);
  await page.getByRole('combobox', { name: /切换模板|Switch template/ }).selectOption('light');
  await expect.poll(() => project.template).toBe('light');
  await page.getByRole('textbox', { name: /用 AI 改写本页|Rewrite this slide with AI/ }).fill('Shorten the title');
  await page.getByRole('button', { name: /改写本页|Rewrite slide/ }).click();
  await expect(page.getByRole('textbox', { name: /页面标题 1|Slide title 1/ })).toHaveValue('AI revised');
  expect(rewriteInput).toMatchObject({ slideId: '1', instruction: 'Shorten the title' });
  await page.getByRole('button', { name: /形状|Shape/ }).click();
  await page.getByRole('button', { name: /保存页面|Save slides/ }).click();
  await page.getByRole('textbox', { name: /用 AI 改写本页|Rewrite this slide with AI/ }).fill('Make this label clearer');
  await page.getByRole('button', { name: /改写文字|Rewrite label/ }).click();
  await expect(page.locator('input[value="Better label"]')).toBeVisible();
  expect(rewriteInput).toMatchObject({ blockId: expect.any(String) });
  expect(pageErrors).toEqual([]);
});

test('PPT M1 creation, outline approval, editing and export entry @smoke', async ({ page }) => {
  const id = 'a'.repeat(32);
  let project: Record<string, unknown> | null = null;
  await page.route('**/api/ppt/folders**', route => route.fulfill({ json: { folders: [] } }));
  await page.route('**/api/providers/models', route => route.fulfill({ json: { groups: [{ provider_id: 'managed-demo', models: [{ value: 'demo-model', label: 'Demo model' }] }] } }));
  await page.route('**/api/providers', route => route.fulfill({ json: { providers: [{ id: 'managed-demo', name: 'Test model', source: 'managed' }] } }));
  await page.route('**/api/ppt/projects**', async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const action = url.pathname.split('/').at(-1);
    if (method === 'GET' && url.pathname === '/api/ppt/projects') return route.fulfill({ json: { projects: project ? [project] : [] } });
    if (method === 'POST' && url.pathname === '/api/ppt/projects') {
      const body = route.request().postDataJSON();
      expect(body.configId).toBe('demo');
      expect(body.model).toBe('demo-model');
      project = { id, title: body.title || body.prompt.slice(0, 60), prompt: body.prompt, pages: body.pages, template: body.template,
        status: 'outline_ready', stage: 'outline', error: '', outline: Array.from({ length: body.pages }, (_, i) => ({ id: String(i + 1), title: `Slide ${i + 1}`, focus: `Focus ${i + 1}` })),
        deck: null, revision: 0, updatedAt: new Date().toISOString() };
      return route.fulfill({ status: 201, json: { project } });
    }
    if (method === 'PATCH' && action === 'outline') {
      project = { ...project, outline: route.request().postDataJSON().slides };
      return route.fulfill({ json: { project } });
    }
    if (method === 'POST' && action === 'generate') {
      const slides = (project!.outline as Array<{ id: string; title: string }>).map(s => ({ id: s.id, title: s.title, bullets: ['First point'] }));
      project = { ...project, status: 'completed', stage: 'completed', revision: 1, deck: { slides } };
      return route.fulfill({ status: 202, json: { project } });
    }
    if (method === 'POST' && action === 'commands') {
      const body = route.request().postDataJSON();
      project = { ...project, deck: body.payload.deck, revision: 2 };
      return route.fulfill({ json: { project, operation: { id: body.id, revision: 2 } } });
    }
    if (method === 'POST' && action === 'publish') {
      project = { ...project, publishedRevision: 2 };
      return route.fulfill({ json: { project } });
    }
    if (method === 'GET' && action === id) return route.fulfill({ json: { project } });
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });

  await page.goto('/ppt');
  await page.getByRole('button', { name: /新建演示文稿|New presentation/ }).click();
  await page.getByRole('textbox', { name: /演示文稿要讲什么|What should this presentation cover/ }).fill('Quarterly business review for management');
  await page.getByRole('spinbutton', { name: /页|slides/ }).fill('3');
  await page.getByRole('combobox', { name: /模型|Model/ }).selectOption('managed-demo::demo-model');
  await page.getByRole('button', { name: /生成大纲|Create outline/ }).click();
  await expect(page.getByRole('heading', { name: /检查并编辑大纲|Review and edit the outline/ })).toBeVisible();
  await page.getByRole('textbox', { name: /页面标题 2|Slide title 2/ }).fill('Updated middle');
  await page.getByRole('button', { name: /确认并生成|Confirm and generate/ }).click();
  await expect(page.getByRole('link', { name: /导出 PPTX|Export PPTX/ })).toHaveAttribute('href', `/api/ppt/projects/${id}/export`);
  await page.getByRole('textbox', { name: /要点 2|Bullet points 2/ }).fill('Revised point');
  await page.getByRole('button', { name: /保存页面|Save slides/ }).click();
  await expect(page.getByRole('textbox', { name: /要点 2|Bullet points 2/ })).toHaveValue('Revised point');
});

test('PPT structured editor persists object commands, history, AI edits and publish @smoke', async ({ page }) => {
  const id = '7'.repeat(32); const slideId = 'slide_demo'; const nodeId = 'node_title'; const now = new Date().toISOString();
  const bounds = { x: 800000, y: 700000, width: 10500000, height: 1200000 };
  let content = 'Stable object title'; let revision = 3; let publishedRevision = 2;
  const operations: Array<Record<string, unknown>> = [];
  const makeProject = () => ({
    id, title: 'Structured deck', prompt: 'Architecture', pages: 1, template: 'light', status: 'completed', stage: 'completed', error: '',
    outline: [{ id: slideId, title: content }], deck: { schemaVersion: 3, deckId: 'deck_demo', slides: [{ id: slideId, title: content, bullets: [], blocks: [], nodes: [{ id: nodeId, type: 'text', semanticRole: 'title', content: { text: content }, geometry: bounds, style: { fontSizePt: 30 } }] }] },
    renderTree: { schemaVersion: 1, units: 'emu', deckId: 'deck_demo', hash: `r${revision}`, size: { width: 12192000, height: 6858000 }, slides: [{ id: slideId, slideId, index: 0, layoutId: 'summary', size: { width: 12192000, height: 6858000 }, background: '#ffffff', elements: [{ id: nodeId, nodeId, kind: 'text', bounds, content: { text: content }, style: { color: '#111111', fontFamily: 'Arial', fontSizePt: 30 }, zIndex: 1 }] }] },
    quality: { status: 'passed', deterministic: { issues: [], hardErrors: 0 }, modelReview: { missing: [], repeated: [], conflicts: [], unsupported: [] }, repairs: [] },
    revision, draftRevision: revision, publishedRevision, favorite: false, pinned: false, folderId: null, tags: [], deletedAt: null, createdAt: now, updatedAt: now,
  });
  await page.route('**/api/ppt/folders**', route => route.fulfill({ json: { folders: [] } }));
  await page.route('**/api/ppt/templates**', route => route.fulfill({ json: { templates: [{ id: 'light', name: 'Light', compatibility: 'mapped', palette: null }] } }));
  await page.route('**/api/ppt/projects**', route => {
    const url = new URL(route.request().url()); const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/ppt/projects') return route.fulfill({ json: { projects: [makeProject()] } });
    if (method === 'GET' && url.pathname.endsWith('/commands')) return route.fulfill({ json: { operations } });
    if (method === 'POST' && url.pathname.endsWith('/commands')) {
      const command = route.request().postDataJSON();
      if (command.type === 'node.setContent') content = command.payload.content.text;
      revision += 1; operations.push({ id: command.id, kind: 'command', revision, command: { type: command.type }, at: now });
      return route.fulfill({ json: { project: makeProject(), operation: operations.at(-1) } });
    }
    if (method === 'POST' && url.pathname.endsWith('/ai-edit')) { content = 'AI focused title'; revision += 1; return route.fulfill({ json: { project: makeProject() } }); }
    if (method === 'POST' && url.pathname.endsWith('/undo')) { revision += 1; content = 'Stable object title'; return route.fulfill({ json: { project: makeProject() } }); }
    if (method === 'POST' && url.pathname.endsWith('/redo')) { revision += 1; content = 'Edited object title'; return route.fulfill({ json: { project: makeProject() } }); }
    if (method === 'POST' && url.pathname.endsWith('/publish')) { publishedRevision = revision; return route.fulfill({ json: { project: makeProject() } }); }
    if (method === 'GET' && url.pathname.endsWith(id)) return route.fulfill({ json: { project: makeProject() } });
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.goto('/ppt');
  await page.getByRole('button', { name: /Structured deck/ }).first().click();
  await expect(page.getByTestId('ppt-structured-editor')).toBeVisible();
  await page.locator(`[data-node-id="${nodeId}"]`).click();
  await page.getByRole('textbox', { name: /Properties|属性|屬性/ }).fill('Edited object title');
  await page.getByRole('button', { name: /Apply content|应用内容|應用內容/ }).click();
  await expect(page.locator(`[data-node-id="${nodeId}"]`)).toContainText('Edited object title');
  await page.getByRole('textbox', { name: /Ask AI|让 AI|讓 AI/ }).fill('Make it more focused');
  await page.getByRole('button', { name: /Edit object with AI|AI 编辑对象|AI 編輯物件/ }).click();
  await expect(page.locator(`[data-node-id="${nodeId}"]`)).toContainText('AI focused title');
  await page.getByRole('button', { name: /Undo|撤销|撤銷/ }).first().click();
  await page.getByRole('button', { name: /Redo|重做/ }).first().click();
  await page.getByRole('button', { name: /Publish|发布|發佈/ }).click();
  expect(publishedRevision).toBe(revision);
  await page.getByText(/Edit history|编辑历史|編輯歷史/).click();
  await expect(page.getByText(/node.setContent/)).toBeVisible();
});

test('PPT M2 library folders, favorites, search and trash @smoke', async ({ page }) => {
  const id = 'b'.repeat(32);
  const folderId = 'c'.repeat(32);
  const now = new Date().toISOString();
  const folders: Array<{ id: string; name: string; count: number; pinned: boolean }> = [];
  let item = { id, title: 'Quarterly plan', prompt: 'plan', pages: 3, template: 'violet', status: 'completed', stage: 'completed', error: '', outline: [{ id: '1', title: 'Opening' }], deck: { slides: [{ id: '1', title: 'Opening', bullets: [] }] }, revision: 1, favorite: false, pinned: false, folderId: null as string | null, tags: [], deletedAt: null as string | null, createdAt: now, updatedAt: now };
  await page.route('**/api/ppt/folders**', route => {
    const method = route.request().method();
    if (method === 'GET') return route.fulfill({ json: { folders } });
    if (method === 'POST') { folders.push({ id: folderId, name: route.request().postDataJSON().name, count: 0, pinned: false }); return route.fulfill({ status: 201, json: { folder: folders[0] } }); }
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.route('**/api/ppt/projects**', route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/ppt/projects') return route.fulfill({ json: { projects: item.deletedAt === null && url.searchParams.get('trash') !== '1' || item.deletedAt !== null && url.searchParams.get('trash') === '1' ? [item] : [] } });
    if (method === 'POST' && url.pathname.endsWith('/bulk')) { if (route.request().postDataJSON().action === 'restore') item.deletedAt = null; return route.fulfill({ json: { ok: true, count: 1 } }); }
    if (method === 'PATCH' && url.pathname.endsWith(id)) { item = { ...item, ...route.request().postDataJSON() }; return route.fulfill({ json: { project: item } }); }
    if (method === 'POST' && url.pathname.endsWith('/trash')) { item.deletedAt = now; return route.fulfill({ json: { project: item } }); }
    if (method === 'POST' && url.pathname.endsWith('/restore')) { item.deletedAt = null; return route.fulfill({ json: { project: item } }); }
    if (method === 'GET' && url.pathname.endsWith(id)) return route.fulfill({ json: { project: item } });
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.goto('/ppt');
  await expect(page.getByText('Quarterly plan')).toBeVisible();
  await page.getByRole('button', { name: /收藏 Quarterly plan|Favorite Quarterly plan/ }).click();
  await page.getByRole('navigation', { name: /我的演示文稿|My presentations/ }).getByRole('button', { name: /收藏|Favorites/ }).click();
  await expect(page.getByText('Quarterly plan')).toBeVisible();
  await page.getByRole('textbox', { name: /搜索文件名或标签|Search name or tags/ }).fill('missing');
  await expect(page.getByText('Quarterly plan')).toHaveCount(0);
  await page.getByRole('textbox', { name: /搜索文件名或标签|Search name or tags/ }).fill('Quarterly');
  await page.getByRole('button', { name: /新建文件夹|Create folder/ }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Marketing');
  await page.getByRole('dialog').getByRole('button', { name: /确认|Confirm/ }).click();
  await expect(page.getByRole('button', { name: 'Marketing (0)' })).toBeVisible();
  await page.getByRole('button', { name: /更多|More/ }).click();
  await page.getByRole('button', { name: /移至文件夹|Move to folder/ }).click();
  await page.getByRole('dialog').getByRole('combobox').selectOption(folderId);
  await page.getByRole('dialog').getByRole('button', { name: /确认|Confirm/ }).click();
  await expect.poll(() => item.folderId).toBe(folderId);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: /更多|More/ }).click();
  await page.getByRole('button', { name: /删除|Delete/ }).last().click();
  await page.getByRole('button', { name: /回收站|Trash/ }).click();
  await expect(page.getByText('Quarterly plan')).toBeVisible();
  await page.getByRole('checkbox', { name: /选择 Quarterly plan|Select Quarterly plan/ }).check();
  await page.getByRole('button', { name: /恢复|Restore/ }).last().click();
  await expect(page.getByText('Quarterly plan')).toHaveCount(0);
});

test('PPT M2 paste and file inputs reach source aware outlines @smoke', async ({ page }) => {
  let created: Record<string, unknown> | null = null;
  const payloads: Record<string, unknown>[] = [];
  await page.route('**/api/providers/models', route => route.fulfill({ json: { groups: [{ provider_id: 'managed-demo', models: [{ value: 'demo-model', label: 'Demo model' }] }] } }));
  await page.route('**/api/providers', route => route.fulfill({ json: { providers: [{ id: 'managed-demo', name: 'Test model', source: 'managed' }] } }));
  await page.route('**/api/ppt/folders**', route => route.fulfill({ json: { folders: [] } }));
  await page.route('**/api/ppt/projects**', route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' && url.pathname === '/api/ppt/projects') return route.fulfill({ json: { projects: created && url.searchParams.get('trash') !== '1' ? [created] : [] } });
    if (route.request().method() === 'POST' && url.pathname === '/api/ppt/projects') {
      const body = route.request().postDataJSON(); payloads.push(body);
      const id = String(payloads.length).repeat(32);
      created = { id, title: body.title || 'Imported notes', prompt: body.prompt || '', pages: 3, template: 'violet', status: 'outline_ready', stage: 'outline', error: '', inputKind: body.inputKind,
        source: { kind: body.inputKind, name: body.fileName || '粘贴文本', text: body.text || 'File facts', images: body.images || [], segments: [{ id: '1', location: '行 1', text: body.text || 'File facts' }] },
        outline: Array.from({ length: 3 }, (_, i) => ({ id: String(i + 1), title: `Slide ${i + 1}`, focus: `Focus ${i + 1}`, refs: ['1'] })), deck: null, revision: 0, sourceRevision: 1, updatedAt: new Date().toISOString() };
      return route.fulfill({ status: 201, json: { project: created } });
    }
    if (route.request().method() === 'GET' && created && url.pathname.endsWith(String(created.id))) return route.fulfill({ json: { project: created } });
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.goto('/ppt');
  await page.getByRole('button', { name: /新建演示文稿|New presentation/ }).click();
  await page.getByRole('button', { name: /粘贴文本|Paste text/ }).click();
  const pasteBox = page.getByRole('textbox', { name: /来源文本|Source text/ });
  await pasteBox.fill('Revenue grew 10%');
  const screenshot = await page.screenshot();
  await pasteBox.evaluate((element, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'dashboard.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, [...screenshot]);
  await expect(page.getByAltText('dashboard')).toBeVisible();
  if (process.env.PPT_PASTE_CAPTURE) {
    await page.screenshot({ path: '/tmp/codepilot-ppt-paste-images-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '/tmp/codepilot-ppt-paste-images-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await page.getByRole('spinbutton', { name: /页|slides/ }).fill('3');
  await page.getByRole('button', { name: /生成大纲|Create outline/ }).click();
  await expect(page.getByText('Revenue grew 10%')).toBeVisible();
  expect(payloads[0]).toMatchObject({ inputKind: 'paste', text: 'Revenue grew 10%', images: [{ type: 'image', caption: 'dashboard' }] });
  await page.getByRole('button', { name: /返回项目库|Back to library/ }).click();
  await page.getByRole('button', { name: /新建演示文稿|New presentation/ }).click();
  await page.getByRole('button', { name: /导入文件|Import file/ }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('File facts') });
  await page.getByRole('button', { name: /生成大纲|Create outline/ }).click();
  await expect(page.getByText('File facts')).toBeVisible();
  expect(payloads[1]).toMatchObject({ inputKind: 'file', fileName: 'notes.md', fileBase64: Buffer.from('File facts').toString('base64') });
});

test('PPTX fidelity import opens without selecting a model @smoke', async ({ page }) => {
  let payload: Record<string, unknown> | null = null; const id = '6'.repeat(32);
  await page.route('**/api/providers/models', route => route.fulfill({ json: { groups: [] } }));
  await page.route('**/api/providers', route => route.fulfill({ json: { providers: [] } }));
  await page.route('**/api/ppt/folders**', route => route.fulfill({ json: { folders: [] } }));
  await page.route('**/api/ppt/templates**', route => route.fulfill({ json: { templates: [] } }));
  await page.route('**/api/ppt/projects**', route => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' && url.pathname === '/api/ppt/projects') return route.fulfill({ json: { projects: [] } });
    if (route.request().method() === 'POST' && url.pathname === '/api/ppt/projects') {
      payload = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { project: { id, title: 'Imported', prompt: 'original.pptx', pages: 1, template: 'violet', status: 'completed', stage: 'completed', error: '', outline: [], deck: { slides: [] }, revision: 1, updatedAt: new Date().toISOString() } } });
    }
    if (route.request().method() === 'GET' && url.pathname.endsWith(id)) return route.fulfill({ json: { project: { id, title: 'Imported', pages: 1, status: 'completed', outline: [], deck: { slides: [] }, revision: 1 } } });
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.goto('/ppt');
  await page.getByRole('button', { name: /New presentation|新建演示文稿/ }).click();
  await page.getByRole('button', { name: /Import file|导入文件/ }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'original.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from('PKsample') });
  await page.getByRole('combobox', { name: /PPTX import mode|PPTX 导入方式/ }).selectOption('editable');
  await expect(page.getByRole('combobox', { name: /Model|模型/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Open editable PPTX|打开并编辑 PPTX/ }).click();
  expect(payload).toMatchObject({ importMode: 'editable', configId: 'pptx-import', model: '' });
});

test('PPT M3 template compatibility and version update workflow @smoke', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const baseId = 'e'.repeat(32);
  const updateId = 'f'.repeat(32);
  const customId = 'a'.repeat(32);
  const now = new Date().toISOString();
  const colors = { background: '#112233', accent: '#ddaa22', foreground: '#ffffff', muted: '#cccccc' };
  const builtIn = { id: 'violet', name: 'Violet', category: '商业汇报', description: 'Built in', pages: 10, kind: 'builtin', compatibility: 'mapped', pinned: false, tags: [], palette: colors };
  const custom = { id: customId, name: 'Brand', category: '我的模板', description: 'Colors mapped', pages: 2, kind: 'uploaded', compatibility: 'mapped', pinned: false, tags: ['自定义'], palette: colors, sampleTitles: ['Brand title'] };
  const base = { id: baseId, title: 'Original plan', prompt: 'Original', pages: 3, template: 'violet', status: 'completed', stage: 'completed', error: '', outline: [{ id: '1', title: 'Old 1', focus: 'Old 1' }], deck: { slides: [{ id: '1', title: 'Old 1', bullets: ['Original fact'] }] }, revision: 1, createdAt: now, updatedAt: now };
  let updated: Record<string, unknown> | null = null;
  const templates: Array<typeof builtIn | typeof custom> = [builtIn];
  let updatePayload: Record<string, unknown> | null = null;
  await page.route('**/api/providers/models', route => route.fulfill({ json: { groups: [{ provider_id: 'managed-demo', models: [{ value: 'demo-model', label: 'Demo model' }] }] } }));
  await page.route('**/api/providers', route => route.fulfill({ json: { providers: [{ id: 'managed-demo', name: 'Test model', source: 'managed' }] } }));
  await page.route('**/api/ppt/folders**', route => route.fulfill({ json: { folders: [] } }));
  await page.route('**/api/ppt/templates**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { templates } });
    if (route.request().method() === 'POST') { expect(route.request().postDataJSON().fileName).toBe('brand.pptx'); templates.push(custom); return route.fulfill({ status: 201, json: { template: custom } }); }
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.route('**/api/ppt/updates', route => {
    updatePayload = route.request().postDataJSON();
    updated = { ...base, id: updateId, title: 'Original plan · 更新版', pages: 6, template: customId, templateSpec: { id: customId, name: 'Brand', version: 1, palette: colors },
      status: 'outline_ready', stage: 'outline', inputKind: 'update', update: { baseSnapshot: { title: base.title, deck: base.deck } }, version: { rootId: baseId, parentId: baseId, number: 2 },
      diff: { kept: 1, rewritten: 1, added: 4, removed: [] }, source: { kind: 'update', name: 'Latest', text: 'Latest fact', segments: [{ id: 'U1', location: '进展', text: 'Latest fact' }] },
      outline: Array.from({ length: 6 }, (_, i) => ({ id: String(i + 1), title: `Updated ${i + 1}`, focus: 'Latest', section: 'Section', refs: ['U1'], baseSlideId: i === 0 ? '1' : null, change: i === 0 ? 'keep' : 'add' })), deck: null };
    return route.fulfill({ status: 201, json: { project: updated } });
  });
  await page.route('**/api/ppt/projects**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/versions')) return route.fulfill({ json: { versions: [{ id: baseId, title: base.title, number: 1, status: 'completed' }, ...(updated ? [{ id: updateId, title: String(updated.title), number: 2, status: 'outline_ready' }] : [])] } });
    if (url.pathname.endsWith(baseId)) return route.fulfill({ json: { project: base } });
    if (url.pathname.endsWith(updateId)) return route.fulfill({ json: { project: updated } });
    return route.fulfill({ json: { projects: url.searchParams.get('trash') === '1' ? [] : updated ? [base, updated] : [base] } });
  });
  await page.goto('/ppt');
  await page.getByRole('button', { name: /模板中心|Template center/ }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'brand.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from('PKsample') });
  await page.locator('button').filter({ hasText: /上传模板|Upload template/ }).click();
  await expect(page.getByText('Brand', { exact: true })).toBeVisible();
  if (process.env.PPT_M3_CAPTURE) await page.screenshot({ path: '/tmp/codepilot-ppt-m3-templates-desktop.png', fullPage: true });
  await page.getByRole('button', { name: /预览|Preview/ }).last().click();
  await expect(page.getByRole('dialog')).toContainText('Brand');
  await page.getByRole('dialog').getByRole('button', { name: /关闭|Close/ }).click();
  await page.getByRole('button', { name: /返回项目库|Back to library/ }).click();
  await page.getByRole('button', { name: /基于上一版更新|Update from previous version/ }).click();
  await page.getByRole('combobox', { name: /工作区中的上一版|Workspace presentation/ }).selectOption(baseId);
  await page.getByRole('textbox', { name: /最新进展|Latest progress/ }).fill('Latest fact');
  await page.getByRole('button', { name: /^(下一步|Next)$/ }).click();
  await page.getByRole('button', { name: /Brand/ }).click();
  await page.getByRole('button', { name: /^(下一步|Next)$/ }).click();
  await page.getByRole('button', { name: /生成更新大纲|Create update outline/ }).click();
  await expect(page.getByRole('heading', { name: 'Original plan · 更新版' })).toBeVisible();
  await expect(page.getByText(/保留 1.*改写 1.*新增 4/)).toBeVisible();
  expect(updatePayload).toMatchObject({ baseProjectId: baseId, progressKind: 'prompt', progressText: 'Latest fact', template: customId, configId: 'demo' });
  await expect(page.getByRole('combobox', { name: /变更方式|Change/ }).first()).toBeVisible();
  if (process.env.PPT_M3_CAPTURE) {
    await page.screenshot({ path: '/tmp/codepilot-ppt-m3-update-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '/tmp/codepilot-ppt-m3-update-mobile.png', fullPage: true });
  }
  expect(pageErrors).toEqual([]);
});
