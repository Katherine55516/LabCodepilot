/**
 * Tests for parseAskQuestions / parseAskAnswers — the AskUserQuestion input +
 * result parsing. Covers single-select, multi-select, multi-question, "Other"
 * free text, and both result-text prefixes. Pure (no React/DOM).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAskQuestions, parseAskAnswers, isAskTool } from '../../lib/tool-ask';

const SINGLE_INPUT = {
  questions: [
    {
      header: '测试',
      multiSelect: false,
      question: '这是一个 AskUserQuestion 工具的测试问题，你能看到这个选项吗？',
      options: [
        { label: '✅ 正常工作', description: '选择此项表示工具调用成功' },
        { label: '❌ 没有正常工作', description: '选择此项表示工具存在问题' },
      ],
    },
  ],
};

describe('isAskTool', () => {
  it('matches AskUserQuestion case-insensitively', () => {
    assert.equal(isAskTool('AskUserQuestion'), true);
    assert.equal(isAskTool('ask_user_question'), true);
    assert.equal(isAskTool('Bash'), false);
  });
});

describe('parseAskQuestions', () => {
  it('extracts questions with options / header / multiSelect', () => {
    const qs = parseAskQuestions(SINGLE_INPUT);
    assert.ok(qs);
    assert.equal(qs!.length, 1);
    assert.equal(qs![0].header, '测试');
    assert.equal(qs![0].multiSelect, false);
    assert.equal(qs![0].options.length, 2);
    assert.equal(qs![0].options[0].label, '✅ 正常工作');
    assert.equal(qs![0].options[0].description, '选择此项表示工具调用成功');
  });

  it('returns null when questions is missing / not an array', () => {
    assert.equal(parseAskQuestions({}), null);
    assert.equal(parseAskQuestions({ questions: 'x' }), null);
    assert.equal(parseAskQuestions(null), null);
  });
});

describe('parseAskAnswers', () => {
  it('single-select: extracts the chosen label ("User has answered" prefix)', () => {
    const result = 'User has answered your questions: "这是一个 AskUserQuestion 工具的测试问题，你能看到这个选项吗？"="✅ 正常工作". You can now continue with the user\'s answers in mind.';
    const answers = parseAskAnswers(result, SINGLE_INPUT);
    assert.equal(answers.length, 1);
    assert.deepEqual(answers[0].answers, ['✅ 正常工作']);
    assert.equal(answers[0].header, '测试');
  });

  it('multi-question: pairs each answer ("Your questions have been answered" prefix)', () => {
    const input = {
      questions: [
        { header: 'A', multiSelect: false, question: 'Q1?', options: [{ label: 'a1', description: '' }] },
        { header: 'B', multiSelect: false, question: 'Q2?', options: [{ label: 'b1', description: '' }] },
      ],
    };
    const result = 'Your questions have been answered: "Q1?"="a1", "Q2?"="b1". You can now continue with these answers in mind.';
    const answers = parseAskAnswers(result, input);
    assert.equal(answers.length, 2);
    assert.deepEqual(answers[0].answers, ['a1']);
    assert.deepEqual(answers[1].answers, ['b1']);
  });

  it('multi-select: splits the ", "-joined labels', () => {
    const input = {
      questions: [
        { header: 'Feat', multiSelect: true, question: 'Which features?', options: [
          { label: 'Auth', description: '' }, { label: 'Cache', description: '' }, { label: 'Logs', description: '' },
        ] },
      ],
    };
    const result = 'User has answered your questions: "Which features?"="Auth, Logs". You can now continue.';
    const answers = parseAskAnswers(result, input);
    assert.equal(answers.length, 1);
    assert.deepEqual(answers[0].answers, ['Auth', 'Logs']);
  });

  it('does NOT split single-select answers that contain a comma', () => {
    const input = {
      questions: [
        { header: 'X', multiSelect: false, question: 'Q?', options: [{ label: 'Yes, definitely', description: '' }] },
      ],
    };
    const result = 'User has answered your questions: "Q?"="Yes, definitely". You can now continue.';
    const answers = parseAskAnswers(result, input);
    assert.deepEqual(answers[0].answers, ['Yes, definitely']);
  });

  it('"Other" free text: surfaces the typed value', () => {
    const input = {
      questions: [
        { header: 'FW', multiSelect: false, question: 'Framework?', options: [{ label: 'React', description: '' }] },
      ],
    };
    const result = 'User has answered your questions: "Framework?"="jquery". You can now continue.';
    const answers = parseAskAnswers(result, input);
    assert.deepEqual(answers[0].answers, ['jquery']);
  });

  it('falls back to pairs when no input is available', () => {
    const result = 'Your questions have been answered: "Q?"="A". You can now continue.';
    const answers = parseAskAnswers(result, undefined);
    assert.equal(answers.length, 1);
    assert.deepEqual(answers[0].answers, ['A']);
  });
});
