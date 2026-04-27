#!/usr/bin/env node
/**
 * Generate and verify Prometheus alert rules for Compound.
 *
 * Modes:
 *   node scripts/generate-alert-rules.mjs
 *   node scripts/generate-alert-rules.mjs --check
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const sourcePath = path.join(repoRoot, 'ops', 'alerting', 'compound-alerts.json');
const outPath = path.join(repoRoot, 'ops', 'alerting', 'prometheus-rules.yml');
const isCheck = process.argv.includes('--check');
const allowedSeverities = new Set(['critical', 'warning']);

function readRules() {
  const raw = readFileSync(sourcePath, 'utf8');
  return JSON.parse(raw);
}

function assertString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function assertDuration(value, field) {
  assertString(value, field);
  if (!/^\d+[smhdwy]$/.test(value)) {
    throw new Error(`${field} must be a Prometheus duration such as 5m or 2h`);
  }
}

function validate(data) {
  if (!data || !Array.isArray(data.groups) || data.groups.length === 0) {
    throw new Error('alert config must define at least one group');
  }

  const seenAlerts = new Set();
  for (const [groupIndex, group] of data.groups.entries()) {
    assertString(group.name, `groups[${groupIndex}].name`);
    if (!Array.isArray(group.rules) || group.rules.length === 0) {
      throw new Error(`groups[${groupIndex}].rules must not be empty`);
    }

    for (const [ruleIndex, rule] of group.rules.entries()) {
      const base = `groups[${groupIndex}].rules[${ruleIndex}]`;
      assertString(rule.alert, `${base}.alert`);
      if (seenAlerts.has(rule.alert)) throw new Error(`duplicate alert ${rule.alert}`);
      seenAlerts.add(rule.alert);

      assertString(rule.expr, `${base}.expr`);
      if (!rule.expr.includes('compound_') && !rule.expr.includes('up{job="compound"}')) {
        throw new Error(`${base}.expr must reference Compound service metrics`);
      }

      assertDuration(rule.for, `${base}.for`);

      if (!rule.labels || typeof rule.labels !== 'object') {
        throw new Error(`${base}.labels must be an object`);
      }
      if (!allowedSeverities.has(rule.labels.severity)) {
        throw new Error(`${base}.labels.severity must be critical or warning`);
      }
      assertString(rule.labels.team, `${base}.labels.team`);

      const annotations = rule.annotations;
      if (!annotations || typeof annotations !== 'object') {
        throw new Error(`${base}.annotations must be an object`);
      }
      assertString(annotations.summary, `${base}.annotations.summary`);
      assertString(annotations.description, `${base}.annotations.description`);
      assertString(annotations.runbook_url, `${base}.annotations.runbook_url`);
    }
  }
}

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function renderMap(map, indent) {
  return Object.entries(map).map(([key, value]) => `${indent}${key}: ${quote(value)}`);
}

function renderYaml(data) {
  const lines = [
    '# Generated from ops/alerting/compound-alerts.json.',
    '# Run `npm run alerts:generate` after editing alert definitions.',
    'groups:',
  ];

  for (const group of data.groups) {
    lines.push(`  - name: ${quote(group.name)}`);
    lines.push('    rules:');
    for (const rule of group.rules) {
      lines.push(`      - alert: ${quote(rule.alert)}`);
      lines.push(`        expr: ${quote(rule.expr)}`);
      lines.push(`        for: ${quote(rule.for)}`);
      lines.push('        labels:');
      lines.push(...renderMap(rule.labels, '          '));
      lines.push('        annotations:');
      lines.push(...renderMap(rule.annotations, '          '));
    }
  }

  return `${lines.join('\n')}\n`;
}

const rules = readRules();
validate(rules);
const rendered = renderYaml(rules);

if (isCheck) {
  if (!existsSync(outPath)) {
    console.error(`Missing generated alert rules: ${path.relative(repoRoot, outPath)}`);
    process.exit(1);
  }
  const current = readFileSync(outPath, 'utf8');
  if (current !== rendered) {
    console.error('Alert rules are out of date. Run `npm run alerts:generate`.');
    process.exit(1);
  }
  console.log('Alert rules are valid and up to date.');
} else {
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, rendered);
  console.log(`Wrote ${path.relative(repoRoot, outPath)}`);
}
