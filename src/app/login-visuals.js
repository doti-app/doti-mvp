export function mountLoginVisuals() {
  const experience = document.getElementById('loginExperience');
  const story = experience?.querySelector('.login-story');
  const visual = experience?.querySelector('.workflow-visual');
  if (!experience || !story || !visual) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(pointer: fine)');
  if (reducedMotion.matches || !finePointer.matches) return;

  let frame;
  story.addEventListener('pointermove', event => {
    const bounds = story.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      story.style.setProperty('--pointer-x', `${x * 100}%`);
      story.style.setProperty('--pointer-y', `${y * 100}%`);
      visual.style.setProperty('--tilt-x', `${(0.5 - y) * 5}deg`);
      visual.style.setProperty('--tilt-y', `${(x - 0.5) * 7}deg`);
    });
  });

  story.addEventListener('pointerleave', () => {
    story.style.setProperty('--pointer-x', '62%');
    story.style.setProperty('--pointer-y', '58%');
    visual.style.setProperty('--tilt-x', '0deg');
    visual.style.setProperty('--tilt-y', '0deg');
  });
}
