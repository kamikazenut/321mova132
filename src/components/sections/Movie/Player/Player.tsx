import { ADS_WARNING_STORAGE_KEY, SpacingClasses } from "@/utils/constants";
import { siteConfig } from "@/config/site";
import useBreakpoints from "@/hooks/useBreakpoints";
import { cn } from "@/utils/helpers";
import { mutateMovieTitle } from "@/utils/movies";
import { getMoviePlayers } from "@/utils/players";
import { Card, Skeleton } from "@heroui/react";
import { useDisclosure, useDocumentTitle, useIdle, useLocalStorage } from "@mantine/hooks";
import dynamic from "next/dynamic";
import { parseAsInteger, useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MovieDetails } from "tmdb-ts/dist/types/movies";
import { usePlayerEvents } from "@/hooks/usePlayerEvents";
import useSupabaseUser from "@/hooks/useSupabaseUser";
import { isPremiumUser } from "@/utils/billing/premium";
const AdsWarning = dynamic(() => import("@/components/ui/overlay/AdsWarning"));
const PlayerAccessNotice = dynamic(() => import("@/components/ui/overlay/PlayerAccessNotice"));
const HlsJsonPlayer = dynamic(() => import("@/components/ui/player/HlsJsonPlayer"));
const MoviePlayerHeader = dynamic(() => import("./Header"));
const MoviePlayerSourceSelection = dynamic(() => import("./SourceSelection"));

interface MoviePlayerProps {
  movie: MovieDetails;
  startAt?: number;
}

const MoviePlayer: React.FC<MoviePlayerProps> = ({ movie, startAt }) => {
  const [seen] = useLocalStorage<boolean>({
    key: ADS_WARNING_STORAGE_KEY,
    getInitialValueInEffect: false,
  });

  const { data: user } = useSupabaseUser();
  const isPremium = isPremiumUser(user);

  const allPlayers = useMemo(() => getMoviePlayers(movie.id, startAt), [movie.id, startAt]);
  // const { isAdBlockDetected, isChecking: isAdBlockChecking } = useAdBlockDetector();
  // const canUse321Player =
  //   Boolean(user) &&
  //   !isUserLoading &&
  //   (isPremium || (!isAdBlockChecking && !isAdBlockDetected));
  // const missing321Requirements = useMemo(() => {
  //   if (isUserLoading || isAdBlockChecking) return [];
  //   const missing: string[] = [];
  //   if (!user) missing.push("Sign in to your account.");
  //   if (!isPremium && isAdBlockDetected) missing.push("Disable your ad blocker for this site.");
  //   return missing;
  // }, [isAdBlockChecking, isAdBlockDetected, isPremium, isUserLoading, user]);
  // TEMP: bypass 321 player requirements (sign-in + adblock) until re-enabled.
  const canUse321Player = true;
  const missing321Requirements = useMemo(() => [] as string[], []);
  const players = useMemo(() => {
    if (canUse321Player) return allPlayers;

    const filteredPlayers = allPlayers.filter((player) => player.mode !== "playlist_json");
    return filteredPlayers.length > 0 ? filteredPlayers : allPlayers;
  }, [allPlayers, canUse321Player]);
  const [dismissedPlayerNotice, setDismissedPlayerNotice] = useState(false);

  const title = mutateMovieTitle(movie);
  const idle = useIdle(3000);
  const { mobile } = useBreakpoints();
  const [opened, handlers] = useDisclosure(false);
  const [selectedSource, setSelectedSource] = useQueryState<number>(
    "src",
    parseAsInteger.withDefault(0),
  );
  const [streamSourceMenuSignal, setStreamSourceMenuSignal] = useState(0);

  usePlayerEvents({ saveHistory: true, trackUiState: false, media: { id: movie.id, type: "movie" } });
  useDocumentTitle(`Play ${title} | ${siteConfig.name}`);

  useEffect(() => {
    setDismissedPlayerNotice(false);
  }, [missing321Requirements.join("|")]);

  useEffect(() => {
    if (!players.length) return;
    if (selectedSource < players.length) return;
    void setSelectedSource(0);
  }, [players.length, selectedSource, setSelectedSource]);

  const PLAYER = useMemo(() => players[selectedSource] || players[0], [players, selectedSource]);
  const isPlaylistJsonPlayer = PLAYER.mode === "playlist_json";
  const handlePrimaryPlayerError = useCallback(() => {
    const fallbackIndex = players.findIndex((_, index) => index > selectedSource);
    if (fallbackIndex < 0) return;
    void setSelectedSource(fallbackIndex);
  }, [players, selectedSource, setSelectedSource]);
  const handleOpenStreamSourceMenu = useCallback(() => {
    setStreamSourceMenuSignal((value) => value + 1);
  }, []);

  return (
    <>
      <AdsWarning />
      <PlayerAccessNotice
        isOpen={missing321Requirements.length > 0 && !dismissedPlayerNotice}
        onClose={() => setDismissedPlayerNotice(true)}
        missingRequirements={missing321Requirements}
      />

      <div className={cn("relative overflow-hidden", SpacingClasses.reset)}>
        <MoviePlayerHeader
          id={movie.id}
          movieName={title}
          onOpenSource={handlers.open}
          onOpenServer={isPlaylistJsonPlayer ? handleOpenStreamSourceMenu : undefined}
          showServerButton={isPlaylistJsonPlayer}
          hidden={idle && !mobile}
        />
        <Card shadow="md" radius="none" className="relative h-screen overflow-hidden">
          <Skeleton className="absolute h-full w-full" />
          {seen && (
            PLAYER.mode === "playlist_json" ? (
              <HlsJsonPlayer
                key={PLAYER.source}
                playlistUrl={PLAYER.source}
                mediaId={movie.id}
                mediaType="movie"
                disableVastAds={isPremium}
                startAt={startAt}
                onFatalError={handlePrimaryPlayerError}
                className="absolute inset-0 z-10 h-full w-full"
                showFloatingSourceButton={false}
                openSourceMenuSignal={streamSourceMenuSignal}
              />
            ) : (
              <iframe
                allowFullScreen
                key={PLAYER.title}
                src={PLAYER.source}
                className={cn("absolute inset-0 z-10 h-full w-full", {
                  "pointer-events-none": idle && !mobile,
                })}
              />
            )
          )}
        </Card>
      </div>

      <MoviePlayerSourceSelection
        opened={opened}
        onClose={handlers.close}
        players={players}
        selectedSource={selectedSource}
        setSelectedSource={setSelectedSource}
      />
    </>
  );
};

MoviePlayer.displayName = "MoviePlayer";

export default MoviePlayer;
