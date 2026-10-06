/** Default document shown in the editor on startup. */

export const DEFAULT_PART = [
  '0 Brick 1 x 1',
  '0 Name: brick_1x1.dat',
  '0 Author: Part Editor',
  '0 !LICENSE Redistributable under CCAL version 2.0',
  '0 BFC CERTIFY CCW',
  '',
  '2 24 -10 0 -10 10 0 -10',
  '2 24 10 0 -10 10 0 10',
  '2 24 10 0 10 -10 0 10',
  '2 24 -10 0 10 -10 0 -10',
  '2 24 -10 -24 -10 10 -24 -10',
  '2 24 10 -24 -10 10 -24 10',
  '2 24 10 -24 10 -10 -24 10',
  '2 24 -10 -24 10 -10 -24 -10',
  '',
  '4 16 -10 0 -10 -10 0 10 10 0 10 10 0 -10',
  '4 16 -10 0 10 -10 0 -10 -10 -24 -10 -10 -24 10',
  '4 16 10 0 -10 10 0 10 10 -24 10 10 -24 -10',
  '4 16 -10 0 -10 10 0 -10 10 -24 -10 -10 -24 -10',
  '4 16 10 0 10 -10 0 10 -10 -24 10 10 -24 10',
  '4 16 -10 -24 -10 10 -24 -10 10 -24 10 -10 -24 10',
  '',
  '1 16 0 -24 0 1 0 0 0 1 0 0 0 1 stud.dat',
].join('\n')

/** Default multi-file workspace: a small assembly + the part it references. */
export const DEFAULT_WORKSPACE = [
  '0 FILE main.ldr',
  '0 Name: main.ldr',
  '0 Author: Part Editor',
  '1 16 0 0 0 1 0 0 0 1 0 0 0 1 brick_1x1.dat',
  '0 NOFILE',
  '',
  '0 FILE brick_1x1.dat',
  ...DEFAULT_PART.split('\n'),
  '0 NOFILE',
].join('\n')
