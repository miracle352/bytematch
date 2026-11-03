import { Hero } from '../sections/Hero';
import { CardStory } from '../sections/CardStory';
import { ByteStory } from '../sections/ByteStory';
import { RepoSection } from '../sections/RepoSection';
import { NetworkSection } from '../sections/NetworkSection';
import { RunIt } from '../sections/RunIt';

export function Home() {
  return (
    <>
      <Hero />
      <CardStory />
      <ByteStory />
      <RepoSection />
      <NetworkSection />
      <RunIt />
    </>
  );
}
