const DEMO_LOOP_BASE = "/landing-prototype/assets/demo-loop";

/** Share of the frame that must be on screen before the loop plays. */
const PLAY_THRESHOLD = 0.25;

/**
 * The muted product loop directly under the hero (owner, 2026-10-10, option
 * "its own section"). It is a different thing from the 16-second reel cut on
 * 2026-08-19: that one showed a build the app had moved past; this one is ten
 * seconds captured from the current app, silent, and it carries its own
 * headlines, so the section prints one line and lets the video tell the story.
 *
 * `preload="none"` is what keeps it free until it is wanted: no source is
 * fetched before `mountDemoLoop` first calls `play()`. The poster is the whole
 * section for anyone who never plays it — reduced motion, or a browser with no
 * IntersectionObserver. The figure is an image to assistive tech (same idiom as
 * the hero window): a silent loop has nothing to operate, only to describe.
 *
 * @param {Record<string, string>} copy
 */
export function renderDemoLoop(copy) {
  return `
    <section class="demo-loop">
      <h2 class="demo-loop__title" data-copy="demoLoopTitle">${copy.demoLoopTitle}</h2>
      <figure class="demo-loop__frame" role="img" aria-label="${copy.demoLoopAlt}">
        <video
          class="demo-loop__video"
          muted
          loop
          playsinline
          preload="none"
          width="1920"
          height="1080"
          poster="${DEMO_LOOP_BASE}-poster.jpg"
        >
          <source src="${DEMO_LOOP_BASE}.webm" type="video/webm" />
          <source src="${DEMO_LOOP_BASE}.mp4" type="video/mp4" />
        </video>
      </figure>
    </section>
  `;
}

/**
 * Play while the frame is on screen, pause when it leaves. Reduced motion is
 * read on every crossing rather than once, so a visitor who flips the setting
 * mid-visit is respected on the next scroll; the loop never starts under it.
 * A refused `play()` (autoplay policy, data saver) leaves the poster showing,
 * which is the correct failure, so the rejection is the only thing swallowed.
 *
 * @param {Element} root
 * @returns {() => void} dispose
 */
export function mountDemoLoop(root) {
  const video = root.querySelector(".demo-loop__video");

  if (!video) {
    throw new Error("Demo loop video is missing.");
  }

  if (typeof IntersectionObserver === "undefined") {
    return () => {};
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.at(-1)?.isIntersecting ?? false;

      if (visible && !reduceMotion.matches) {
        video.play()?.catch(() => {});
      } else {
        video.pause();
      }
    },
    { threshold: PLAY_THRESHOLD },
  );
  observer.observe(video);

  return () => {
    observer.disconnect();
    video.pause();
  };
}
