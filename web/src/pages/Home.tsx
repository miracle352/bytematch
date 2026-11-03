import { Hero } from '../sections/Hero';
import { CardStory } from '../sections/CardStory';
import { ByteStory } from '../sections/ByteStory';
import { RepoDemo } from '../sections/RepoDemo';
import { Explorer } from '../sections/Explorer';
import { AgentDemo } from '../sections/AgentDemo';
import { NetworkSection } from '../sections/NetworkSection';
import { RootStory } from '../sections/RootStory';
import { RunIt } from '../sections/RunIt';
import { FinalCta } from '../sections/FinalCta';

export function Home() {
  return (
    <>
      <Hero />
      <CardStory />
      <ByteStory />
      <RepoDemo />
      <Explorer />
      <AgentDemo />
      <NetworkSection />
      <RootStory />
      <RunIt />
      <FinalCta />
    </>
  );
}
