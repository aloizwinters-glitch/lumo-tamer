import { describe, it, expect } from 'vitest';
import {
  AUTO_BYTES_PER_TOKEN,
  AUTO_TOKEN_CALIBRATION,
  estimatePromptTokens,
} from '../../src/app/token-estimate.js';

describe('estimatePromptTokens', () => {
  it('returns 0 when off', () => {
    expect(estimatePromptTokens(1000, 'off')).toBe(0);
  });

  it('uses 4/0.435 as the auto divisor so factor 1.0 is the calibrated baseline', () => {
    expect(AUTO_TOKEN_CALIBRATION).toBe(0.435);
    expect(AUTO_BYTES_PER_TOKEN).toBeCloseTo(4 / 0.435);
    expect(estimatePromptTokens(400, 'auto', 1)).toBe(Math.ceil(400 / (4 / 0.435)));
  });

  it('applies factor on top of the auto calibration, not on top of naive /4', () => {
    const auto = estimatePromptTokens(400, 'auto', 1);
    const tuned = estimatePromptTokens(400, 'auto', 0.9);
    expect(auto).toBe(Math.ceil(400 / (4 / 0.435)));
    expect(tuned).toBe(Math.ceil(auto * 0.9));
    expect(tuned).not.toBe(Math.ceil((400 / 4) * 0.9));
  });

  it('does not bake the calibration into a manual divisor', () => {
    expect(estimatePromptTokens(400, 4, 1)).toBe(100);
  });
});
