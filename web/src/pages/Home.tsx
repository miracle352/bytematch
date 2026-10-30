import { Hero } from '../sections/Hero';
import { CardStory } from '../sections/CardStory';
import { ByteStory } from '../sections/ByteStory';
import { ClaimCheck } from '../sections/ClaimCheck';
import { NetworkSection } from '../sections/NetworkSection';
import { RunIt } from '../sections/RunIt';

export function Home() {
  return (
    <>
      <Hero />
      <CardStory />
      <ByteStory />
      <NetworkSection />
      <ClaimCheck />
      <RunIt />
    </>
  );
}
