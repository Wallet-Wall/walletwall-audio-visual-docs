// Fixture storyboard provider: returns a committed, human-authored storyboard.
// It stands in for an LLM planner with the exact same contract, so everything
// downstream (assembly, validation, render, publishing) is exercised without
// credentials or network access.

import { readFileSync } from 'node:fs';
import { STORYBOARD_CONTRACT, type PlanningRequest, type Storyboard, type StoryboardProvider } from './storyboard.ts';

export class FixtureStoryboardProvider implements StoryboardProvider {
  readonly id = 'fixture';
  private readonly fixturePath: string;

  constructor(fixturePath: string) {
    this.fixturePath = fixturePath;
  }

  async plan(request: PlanningRequest): Promise<Storyboard> {
    const storyboard = JSON.parse(readFileSync(this.fixturePath, 'utf8')) as Storyboard;
    if (storyboard.contract !== STORYBOARD_CONTRACT) throw new Error(`fixture ${this.fixturePath}: contract ${String(storyboard.contract)} != ${STORYBOARD_CONTRACT}`);
    if (storyboard.videoId !== request.videoId) throw new Error(`fixture is for ${storyboard.videoId}, not ${request.videoId}`);
    if (storyboard.docPath !== request.source.docPath) throw new Error(`fixture is for ${storyboard.docPath}, not ${request.source.docPath}`);
    return storyboard;
  }
}
