import { describe, expect, it } from 'vitest';
import { v1 } from '../../test/fixtures.ts';
import { catalogEvent, filterProperties, isServerOnly } from './catalog.ts';

const catalog = v1().events.allowed;

describe('catalogEvent', () => {
  it('finds events of the version and nothing else', () => {
    expect(catalogEvent(catalog, 'cta_clicked')?.properties).toEqual(['result_id', 'action']);
    expect(catalogEvent(catalog, 'recommendation_expanded')).toBeUndefined();
    expect(catalogEvent(catalog, 'toString')).toBeUndefined();
  });
});

describe('filterProperties', () => {
  it('keeps whitelisted properties and lists the dropped keys', () => {
    const definition = catalogEvent(catalog, 'answer_submitted');
    if (!definition) throw new Error('fixture');
    expect(
      filterProperties(definition, { answer_kind: 'number', answer: 12, raw_value: 'remote' }),
    ).toEqual({ properties: { answer_kind: 'number' }, dropped: ['answer', 'raw_value'] });
  });

  it('drops everything for an event without properties', () => {
    const definition = catalogEvent(catalog, 'session_started');
    if (!definition) throw new Error('fixture');
    expect(filterProperties(definition, { x: 1 })).toEqual({ properties: {}, dropped: ['x'] });
  });
});

describe('isServerOnly', () => {
  it('marks session_started only', () => {
    expect(isServerOnly('session_started')).toBe(true);
    expect(isServerOnly('step_viewed')).toBe(false);
  });
});
