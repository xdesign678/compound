# Claude Design Style Evaluation Harness

Based on Karpathy's AutoResearch methodology.

## Quick Start

```bash
# Evaluate a single HTML file
python run_eval.py tests/T01-landing.html --test-id T01 --verbose

# Batch evaluate all test files
python run_eval.py --batch tests/

# JSON output for programmatic use
python run_eval.py tests/T01-landing.html --test-id T01 --json
```

## Architecture

```
eval/
  run_eval.py      # FIXED evaluator (never modify during optimization)
  tests/           # Generated HTML files (T01-T10)
  EVAL-PLAN.md     # Full evaluation plan (in parent dir)
```

## AutoResearch Loop

1. Generate: Use claude-design-style skill to create test page
2. Save: Place HTML in `tests/T{xx}-{name}.html`
3. Evaluate: `python run_eval.py tests/T{xx}-{name}.html --test-id T{xx} -v`
4. Decide: Score improved? Keep skill changes. Otherwise revert.
5. Iterate: Fix lowest-scoring dimension, regenerate, re-evaluate.

## Scoring Dimensions

| Dim | Weight | What it measures                                              |
| --- | ------ | ------------------------------------------------------------- |
| D1  | 25%    | CSS token accuracy vs reference values                        |
| D2  | 20%    | Anti-pattern violations (gradients, pill buttons, etc.)       |
| D3  | 15%    | Typography system (serif/sans assignment, sizes, line-height) |
| D4  | 15%    | Layout & spacing (content width, nav height, 8px grid)        |
| D5  | 15%    | Responsive design & accessibility                             |
| D6  | 10%    | Component completeness                                        |
