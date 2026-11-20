// Tarçın: kulaklıklı, mikrofonlu turuncu tekir kedi. Katmanlı satır içi SVG + küçük bir animasyon API'si.
//   createHost(el) → { setEmotion(name), gesture(name), talk(levelFn | null), lookAt(x | null), dispose(), el }
//   emotion: neutral · happy · excited · wow · think · sad · love · wink
//   gesture: wave · clap · point · drum · jump · shrug · heart
//   talk(fn): fn() her karede 0..1 ses düzeyi döndürür (ağız buna göre açılır); null → ağız kapanır
//   lookAt(x): -1 (sol) … 1 (sağ); null → kendi kendine etrafa bakar
// Bütün hareketler transform/opacity ile yapılır; döndürme merkezleri iç içe <g translate> ile verilir.

export const EMOTIONS = ['neutral', 'happy', 'excited', 'wow', 'think', 'sad', 'love', 'wink'];
export const GESTURES = { wave: 1900, clap: 1700, point: 2300, drum: 1700, jump: 1250, shrug: 1800, heart: 2400, listen: 1650, nod: 1350, knead: 2350, boop: 1200 };

const C = {
  fur: '#F7993B', furD: '#DE7822', furS: '#E98A2C', furL: '#FFBC6E', cream: '#FFEED2', creamD: '#EFCF9F',
  ear: '#FF9FB6', nose: '#FF6F96', ink: '#3B1F2B', mouth: '#7A1F33', tongue: '#FF86A6',
  navy: '#2A2270', navyL: '#6456E0', teal: '#2ED3B7', yellow: '#FFD34D', hot: '#FF5C8A', eye: '#2B1B45', iris: '#1FB89E',
};
const HEART = 'M0 11 C-24 -6 -13 -25 0 -12 C13 -25 24 -6 0 11 Z';
const STAR = 'M0 -18 Q3 -3 18 0 Q3 3 0 18 Q-3 3 -18 0 Q-3 -3 0 -18 Z';
const DROP = 'M0 -12 C8 0 10 6 0 12 C-10 6 -8 0 0 -12 Z';
const HEAD = 'M150 198 C150 112 212 72 300 72 C388 72 450 112 450 198 C450 253 369 309 300 309 C231 309 150 253 150 198 Z';

const CSS = `
.tc{display:block;width:100%;height:100%;overflow:visible}
.tc-costume{display:none}
.tc[data-look=detective] .tc-detective,.tc[data-look=dj] .tc-dj{display:inline}
.tc[data-look=detective].tc-g-listen .tc-monocle-glint{animation:tc-lens 1.65s ease-in-out}
@keyframes tc-lens{0%,100%{opacity:0}34%,56%{opacity:.85}}
.tc[data-look=dj].tc-g-clap .tc-head-gest,.tc[data-look=dj].tc-g-drum .tc-head-gest{animation:tc-groove .52s ease-in-out 3}
@keyframes tc-groove{0%,100%{transform:rotate(-3deg)}48%{transform:rotate(6deg) translateY(5px)}}
.tc[data-look=dj].tc-g-clap .tc-record,.tc[data-look=dj].tc-g-drum .tc-record{animation:tc-scratch .45s ease-in-out 4}
@keyframes tc-scratch{0%,100%{transform:rotate(-20deg)}44%{transform:rotate(34deg)}}
.tc-g-listen .tc-head-gest{animation:tc-listen 1.65s ease-in-out}
.tc-g-listen .tc-arm-r{animation:tc-cup 1.65s ease-in-out}
.tc-g-nod .tc-head-gest{animation:tc-nod 1.35s ease-in-out}
@keyframes tc-listen{0%,100%{transform:none}28%,70%{transform:translate(-9px,7px) rotate(-10deg)}}
@keyframes tc-cup{0%,100%{transform:rotate(-34deg)}30%,72%{transform:translate(8px,-20px) rotate(-155deg)}}
@keyframes tc-nod{0%,100%{transform:none}24%,65%{transform:translateY(10px) rotate(3deg)}44%,82%{transform:translateY(-4px) rotate(-2deg)}}
.tc-tail{animation:tc-tail 2.6s ease-in-out infinite alternate}
@keyframes tc-tail{from{transform:rotate(-8deg)}to{transform:rotate(10deg)}}
.tc[data-emo=excited] .tc-tail,.tc[data-emo=love] .tc-tail{animation-duration:.9s}
.tc[data-emo=sad] .tc-tail{animation-duration:4.2s}
.tc-body{animation:tc-breath 2.3s ease-in-out infinite alternate}
@keyframes tc-breath{from{transform:scale(1,1)}to{transform:scale(1.014,1.032)}}
.tc-head-bob{animation:tc-bob 2.3s ease-in-out infinite alternate}
@keyframes tc-bob{from{transform:translateY(1px)}to{transform:translateY(-5px)}}
.tc-head-emo{transition:transform .3s cubic-bezier(.3,1.5,.5,1)}
.tc[data-emo=think] .tc-head-emo{transform:rotate(5deg)}
.tc[data-emo=sad] .tc-head-emo{transform:rotate(-3deg) translateY(5px)}
.tc[data-emo=wink] .tc-head-emo{transform:rotate(-4deg)}
.tc[data-emo=love] .tc-head-emo{transform:rotate(3deg)}
.tc[data-emo=wow] .tc-head-emo{transform:translateY(-6px) scale(1.02)}
.tc-head-look{transition:transform .35s ease-out}
.tc-pop .tc-head-pop{animation:tc-pop .42s cubic-bezier(.3,1.6,.5,1)}
@keyframes tc-pop{0%{transform:scale(1)}35%{transform:scale(1.06,.95)}70%{transform:scale(.98,1.03)}100%{transform:scale(1)}}
.tc-ear-emo{transition:transform .28s cubic-bezier(.3,1.5,.5,1)}
.tc[data-emo=sad] .tc-ear-l .tc-ear-emo{transform:rotate(-24deg) translateY(8px)}
.tc[data-emo=sad] .tc-ear-r .tc-ear-emo{transform:rotate(24deg) translateY(8px)}
.tc[data-emo=excited] .tc-ear-l .tc-ear-emo,.tc[data-emo=wow] .tc-ear-l .tc-ear-emo{transform:rotate(7deg) scaleY(1.07)}
.tc[data-emo=excited] .tc-ear-r .tc-ear-emo,.tc[data-emo=wow] .tc-ear-r .tc-ear-emo{transform:rotate(-7deg) scaleY(1.07)}
.tc[data-emo=think] .tc-ear-r .tc-ear-emo{transform:rotate(12deg)}
.tc-ear.tc-twitch{animation:tc-twitch .46s ease-in-out}
@keyframes tc-twitch{0%,100%{transform:rotate(0)}25%{transform:rotate(-13deg)}55%{transform:rotate(8deg)}80%{transform:rotate(-4deg)}}
.tc-wh{animation:tc-wh 3.4s ease-in-out infinite alternate}
.tc-wh-r{animation-delay:-1.2s}
@keyframes tc-wh{0%,70%{transform:rotate(0)}85%{transform:rotate(3deg)}100%{transform:rotate(-2deg)}}

.tc-eye-open,.tc-eye-arc,.tc-eye-heart{transition:opacity .1s linear,transform .16s cubic-bezier(.3,1.5,.5,1)}
.tc-eye-arc,.tc-eye-heart{opacity:0}
.tc-eye-blink{transition:transform .07s linear}
.tc-blink .tc-eye-blink{transform:scaleY(.07)}
.tc-pupil{transition:transform .28s ease-out}
.tc-pupil-s{transition:transform .2s cubic-bezier(.3,1.5,.5,1)}
.tc-lid{transform:translateY(-96px);transition:transform .18s ease-out}
.tc-shine-star{opacity:0;transition:opacity .15s}
.tc[data-emo=happy] .tc-eye-open,.tc[data-emo=love] .tc-eye-open,.tc[data-emo=wink] .tc-eye-r .tc-eye-open{opacity:0}
.tc[data-emo=happy] .tc-eye-arc,.tc[data-emo=wink] .tc-eye-r .tc-eye-arc{opacity:1}
.tc[data-emo=love] .tc-eye-heart{opacity:1;animation:tc-beat .5s ease-in-out infinite alternate}
@keyframes tc-beat{from{transform:scale(.9)}to{transform:scale(1.1)}}
.tc[data-emo=wow] .tc-eye-open{transform:scale(1.12)}
.tc[data-emo=wow] .tc-pupil-s{transform:scale(.7)}
.tc[data-emo=excited] .tc-eye-open{transform:scale(1.07)}
.tc[data-emo=excited] .tc-pupil-s{transform:scale(1.08)}
.tc[data-emo=excited] .tc-shine-star{opacity:1;animation:tc-spin 2.4s linear infinite}
.tc[data-emo=excited] .tc-shine-dot{opacity:0}
@keyframes tc-spin{to{transform:rotate(360deg)}}
.tc[data-emo=sad] .tc-eye-l .tc-lid{transform:translateY(-27px) rotate(-15deg)}
.tc[data-emo=sad] .tc-eye-r .tc-lid{transform:translateY(-27px) rotate(15deg)}
.tc[data-emo=sad] .tc-pupil-s{transform:scale(1.06)}
.tc[data-emo=think] .tc-lid{transform:translateY(-30px)}
.tc[data-emo=think] .tc-eye-r .tc-lid{transform:translateY(-40px) rotate(-6deg)}

.tc-brow{transition:transform .2s cubic-bezier(.3,1.5,.5,1)}
.tc[data-emo=happy] .tc-brow{transform:translateY(-5px)}
.tc[data-emo=excited] .tc-brow{transform:translateY(-13px)}
.tc[data-emo=wow] .tc-brow{transform:translateY(-19px)}
.tc[data-emo=love] .tc-brow{transform:translateY(-7px)}
.tc[data-emo=think] .tc-brow-l{transform:translateY(5px) rotate(9deg)}
.tc[data-emo=think] .tc-brow-r{transform:translateY(-14px) rotate(-9deg)}
.tc[data-emo=sad] .tc-brow-l{transform:translateY(2px) rotate(-20deg)}
.tc[data-emo=sad] .tc-brow-r{transform:translateY(2px) rotate(20deg)}
.tc[data-emo=wink] .tc-brow-l{transform:translateY(-10px)}
.tc[data-emo=wink] .tc-brow-r{transform:translateY(4px) rotate(6deg)}

.tc-mouth-w,.tc-mouth-sad,.tc-mouth-o,.tc-mouth-smile,.tc-mouth-open{transition:opacity .1s linear}
.tc-mouth-sad,.tc-mouth-o,.tc-mouth-smile{opacity:0}
.tc-mouth-open{transform:scale(.85,0)}
.tc-mouth-smile{transform:scale(1,.6)}
.tc-mouth-o{transform:scale(.85)}
.tc[data-emo=excited] .tc-mouth-smile,.tc[data-emo=wink] .tc-mouth-smile{opacity:1}
.tc[data-emo=excited] .tc-mouth-w,.tc[data-emo=wink] .tc-mouth-w,.tc[data-emo=wow] .tc-mouth-w,.tc[data-emo=sad] .tc-mouth-w{opacity:0}
.tc[data-emo=excited] .tc-mouth-open,.tc[data-emo=wink] .tc-mouth-open,.tc[data-emo=wow] .tc-mouth-open{opacity:0}
.tc[data-emo=wow] .tc-mouth-o{opacity:1}
.tc[data-emo=sad] .tc-mouth-sad{opacity:1}
.tc-mouth-shape{transition:transform .2s cubic-bezier(.3,1.5,.5,1)}
.tc[data-emo=happy] .tc-mouth-shape,.tc[data-emo=love] .tc-mouth-shape{transform:scale(1.2,1.15)}
.tc[data-emo=think] .tc-mouth-shape{transform:translate(9px,1px) scale(.72) rotate(-8deg)}

.tc-x{opacity:0}
.tc[data-emo=excited] .tc-x-spark{opacity:1;animation:tc-spark 1s ease-in-out infinite alternate}
.tc[data-emo=excited] .tc-x-spark.tc-d2{animation-delay:-.35s}
.tc[data-emo=excited] .tc-x-spark.tc-d3{animation-delay:-.7s}
@keyframes tc-spark{from{transform:scale(.45) rotate(-20deg);opacity:.35}to{transform:scale(1.15) rotate(20deg);opacity:1}}
.tc[data-emo=love] .tc-x-heart{animation:tc-float 1.7s ease-out infinite}
.tc[data-emo=love] .tc-x-heart.tc-d2{animation-delay:-.6s}
.tc[data-emo=love] .tc-x-heart.tc-d3{animation-delay:-1.1s}
@keyframes tc-float{0%{transform:translateY(18px) scale(.4);opacity:0}25%{opacity:1}100%{transform:translateY(-46px) scale(1.15);opacity:0}}
.tc[data-emo=think] .tc-x-dot{animation:tc-dot 1.2s ease-in-out infinite}
.tc[data-emo=think] .tc-x-dot:nth-child(2){animation-delay:.18s}
.tc[data-emo=think] .tc-x-dot:nth-child(3){animation-delay:.36s}
@keyframes tc-dot{0%,100%{transform:translateY(0);opacity:.55}40%{transform:translateY(-12px);opacity:1}}
.tc[data-emo=wow] .tc-x-line{opacity:1;animation:tc-line .7s ease-in-out infinite alternate}
@keyframes tc-line{from{transform:scaleY(.5);opacity:.5}to{transform:scaleY(1.15);opacity:1}}
.tc[data-emo=sad] .tc-x-tear{animation:tc-tear 1.9s ease-in infinite}
@keyframes tc-tear{0%{transform:translateY(-6px) scale(.5);opacity:0}25%{opacity:.95;transform:translateY(0) scale(1)}80%{opacity:.9}100%{transform:translateY(34px) scale(.9);opacity:0}}

.tc-steam{animation:tc-steam 3s ease-in-out infinite}
.tc-steam2{animation-delay:-1.5s}
@keyframes tc-steam{0%{transform:translateY(8px) scaleY(.7);opacity:0}35%{opacity:.6}100%{transform:translateY(-24px) scaleY(1.15);opacity:0}}
.tc-led{animation:tc-led 2.8s ease-in-out infinite alternate}
@keyframes tc-led{from{opacity:.65}to{opacity:1}}

.tc-arm{transition:transform .3s cubic-bezier(.3,1.4,.5,1)}
.tc-arm-l{transform:rotate(34deg)}
.tc-arm-r{transform:rotate(-34deg)}
.tc-pads,.tc-finger{opacity:0;transition:opacity .12s}
.tc-heart-pop{opacity:0;transform:scale(0)}

.tc-g-wave .tc-arm-r{animation:tc-wave-r 1.9s ease-in-out}
.tc-g-wave .tc-arm-r .tc-pads,.tc-g-shrug .tc-pads,.tc-g-jump .tc-pads{opacity:1}
@keyframes tc-wave-r{0%,100%{transform:rotate(-34deg)}14%{transform:translate(44px,-4px) rotate(-162deg) scaleY(1.34)}28%{transform:translate(44px,-4px) rotate(-136deg) scaleY(1.34)}42%{transform:translate(44px,-4px) rotate(-164deg) scaleY(1.34)}56%{transform:translate(44px,-4px) rotate(-136deg) scaleY(1.34)}70%{transform:translate(44px,-4px) rotate(-164deg) scaleY(1.34)}84%{transform:translate(44px,-4px) rotate(-142deg) scaleY(1.34)}}
.tc-g-wave .tc-head-gest{animation:tc-tilt-r 1.9s ease-in-out}
@keyframes tc-tilt-r{0%,100%{transform:rotate(0)}20%,80%{transform:rotate(-5deg)}}

.tc-g-clap .tc-arm-l{animation:tc-clap-l 1.7s linear}
.tc-g-clap .tc-arm-r{animation:tc-clap-r 1.7s linear}
@keyframes tc-clap-l{0%,100%{transform:rotate(34deg)}8%{transform:translate(0,-30px) rotate(-18deg)}16%,32%,48%,64%,80%{transform:translate(0,-30px) rotate(-62deg)}24%,40%,56%,72%,88%{transform:translate(0,-30px) rotate(-22deg)}}
@keyframes tc-clap-r{0%,100%{transform:rotate(-34deg)}8%{transform:translate(0,-30px) rotate(18deg)}16%,32%,48%,64%,80%{transform:translate(0,-30px) rotate(62deg)}24%,40%,56%,72%,88%{transform:translate(0,-30px) rotate(22deg)}}
.tc-g-clap .tc-head-gest{animation:tc-bob 1.7s ease-in-out}
@keyframes tc-bob{0%,100%{transform:translateY(0)}16%,48%,80%{transform:translateY(4px)}32%,64%{transform:translateY(-3px)}}

.tc-g-point .tc-arm-r{animation:tc-point-r 2.3s ease-in-out}
.tc-g-point .tc-arm-r .tc-finger{opacity:1}
@keyframes tc-point-r{0%,100%{transform:rotate(-34deg)}12%{transform:translate(46px,-6px) rotate(-160deg) scaleY(1.4)}26%{transform:translate(46px,-22px) rotate(-162deg) scaleY(1.46)}40%{transform:translate(46px,-6px) rotate(-160deg) scaleY(1.4)}54%{transform:translate(46px,-22px) rotate(-162deg) scaleY(1.46)}68%,86%{transform:translate(46px,-8px) rotate(-160deg) scaleY(1.4)}}
.tc-g-point .tc-head-gest{animation:tc-lookup 2.3s ease-in-out}
@keyframes tc-lookup{0%,100%{transform:rotate(0)}15%,85%{transform:rotate(4deg) translateY(-4px)}}

.tc-g-drum .tc-arm-l{animation:tc-drum-l .34s linear 5}
.tc-g-drum .tc-arm-r{animation:tc-drum-r .34s linear 5}
@keyframes tc-drum-l{0%,100%{transform:rotate(34deg)}25%{transform:translate(0,-24px) rotate(22deg)}50%{transform:rotate(34deg)}}
@keyframes tc-drum-r{0%,50%,100%{transform:rotate(-34deg)}75%{transform:translate(0,-24px) rotate(-22deg)}}
.tc-g-drum .tc-head-gest{animation:tc-bob 1.7s ease-in-out}

.tc-g-jump .tc-jump{animation:tc-jump 1.25s cubic-bezier(.3,.6,.4,1)}
@keyframes tc-jump{0%,100%{transform:translateY(0) scale(1,1)}10%{transform:translateY(8px) scale(1.05,.93)}34%{transform:translateY(-70px) scale(.97,1.05)}54%{transform:translateY(0) scale(1.06,.92)}70%{transform:translateY(-26px) scale(.99,1.02)}86%{transform:translateY(0) scale(1.03,.97)}}
.tc-g-jump .tc-arm-l{animation:tc-up-l 1.25s ease-in-out}
.tc-g-jump .tc-arm-r{animation:tc-up-r 1.25s ease-in-out}
@keyframes tc-up-l{0%,100%{transform:rotate(34deg)}18%,80%{transform:translate(-22px,-18px) rotate(142deg) scaleY(1.2)}}
@keyframes tc-up-r{0%,100%{transform:rotate(-34deg)}18%,80%{transform:translate(22px,-18px) rotate(-142deg) scaleY(1.2)}}

.tc-g-shrug .tc-arm-l{animation:tc-shrug-l 1.8s ease-in-out}
.tc-g-shrug .tc-arm-r{animation:tc-shrug-r 1.8s ease-in-out}
@keyframes tc-shrug-l{0%,100%{transform:rotate(34deg)}18%,78%{transform:translate(-30px,-22px) rotate(116deg)}48%{transform:translate(-30px,-30px) rotate(122deg)}}
@keyframes tc-shrug-r{0%,100%{transform:rotate(-34deg)}18%,78%{transform:translate(30px,-22px) rotate(-116deg)}48%{transform:translate(30px,-30px) rotate(-122deg)}}
.tc-g-shrug .tc-head-gest{animation:tc-shrug-h 1.8s ease-in-out}
@keyframes tc-shrug-h{0%,100%{transform:rotate(0)}20%,78%{transform:rotate(7deg) translateY(6px)}}

.tc-g-heart .tc-arm-l{animation:tc-heart-l 2.4s ease-in-out}
.tc-g-knead .tc-arm-l,.tc-g-knead .tc-arm-r{animation:tc-knead .58s ease-in-out 4 alternate}
.tc-g-knead .tc-arm-r{animation-direction:alternate-reverse}
.tc-g-boop .tc-head-gest{animation:tc-boop 1.2s ease-in-out}
@keyframes tc-knead{from{transform:translateY(-5px) rotate(-6deg)}to{transform:translateY(7px) rotate(4deg)}}
@keyframes tc-boop{0%,100%{transform:none}48%{transform:translateY(5px) scale(1.045) rotate(-3deg)}}
.tc-g-heart .tc-arm-r{animation:tc-heart-r 2.4s ease-in-out}
@keyframes tc-heart-l{0%,100%{transform:rotate(34deg)}14%,80%{transform:translate(8px,-34px) rotate(-52deg)}}
@keyframes tc-heart-r{0%,100%{transform:rotate(-34deg)}14%,80%{transform:translate(-8px,-34px) rotate(52deg)}}
.tc-g-heart .tc-heart-pop{animation:tc-heart-pop 2.4s ease-out}
@keyframes tc-heart-pop{0%,12%{opacity:0;transform:translateY(0) scale(0)}24%{opacity:1;transform:translateY(-6px) scale(1.25)}34%{transform:translateY(-4px) scale(1)}44%{transform:translateY(-6px) scale(1.18)}54%{opacity:1;transform:translateY(-4px) scale(1)}100%{opacity:0;transform:translateY(-105px) scale(1.7)}}
.tc-g-heart .tc-head-gest{animation:tc-tilt-r 2.4s ease-in-out}
`;

let styled = false;
function injectStyle() {
  if (styled || document.getElementById('tc-style')) { styled = true; return; }
  const s = document.createElement('style'); s.id = 'tc-style'; s.textContent = CSS; document.head.appendChild(s); styled = true;
}

function eye(side, cx, id) {
  return `<g class="tc-eye tc-eye-${side}" transform="translate(${cx} 194)">
    <g class="tc-eye-open"><g class="tc-eye-blink"><g clip-path="url(#${id}-eye)">
      <ellipse rx="36" ry="42" fill="#fff"/>
      <ellipse cy="-40" rx="40" ry="16" fill="#D9D3F2" opacity=".55"/>
      <g class="tc-pupil"><g class="tc-pupil-s">
        <ellipse rx="27" ry="32" fill="${C.iris}"/><ellipse cy="2" rx="21" ry="26" fill="${C.eye}"/>
        <circle class="tc-shine-dot" cx="-9" cy="-13" r="9.5" fill="#fff"/><circle cx="10" cy="11" r="4.5" fill="#fff" opacity=".9"/>
        <g transform="translate(-8 -12) scale(.82)"><path class="tc-shine-star" d="${STAR}" fill="#fff"/></g>
      </g></g>
      <g class="tc-lid"><rect x="-64" y="-70" width="128" height="70" fill="${C.fur}"/><path d="M-64 0 H64" stroke="${C.furD}" stroke-width="6"/></g>
    </g></g></g>
    <path class="tc-eye-arc" d="M-27 9 Q0 -27 27 9" fill="none" stroke="${C.eye}" stroke-width="10" stroke-linecap="round"/>
    <g transform="translate(0 6) scale(2.05)"><path class="tc-eye-heart" d="${HEART}" fill="${C.hot}"/></g>
  </g>`;
}

function arm(side) {
  const s = side === 'l' ? -1 : 1;
  return `<g class="tc-arm tc-arm-${side}">
    <path d="M0 4 L0 68" stroke="${C.fur}" stroke-width="44" stroke-linecap="round"/>
    <path d="M${s * 19} 30 L${s * 5} 33 M${s * 19} 47 L${s * 7} 49" stroke="${C.furD}" stroke-width="7" stroke-linecap="round"/>
    <path class="tc-finger" d="M0 96 L0 122" stroke="${C.cream}" stroke-width="17" stroke-linecap="round"/>
    <ellipse cx="0" cy="84" rx="27" ry="23" fill="${C.cream}"/>
    <path d="M-9 93 L-9 104 M9 93 L9 104" stroke="${C.creamD}" stroke-width="4" stroke-linecap="round"/>
    <g class="tc-pads" fill="${C.ear}"><ellipse cx="0" cy="89" rx="11" ry="8.5"/><circle cx="-13" cy="75" r="5"/><circle cx="0" cy="70.5" r="5"/><circle cx="13" cy="75" r="5"/></g>
  </g>`;
}

function markup(id) {
  return `<svg class="tc" data-emo="neutral" viewBox="0 0 600 640" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <clipPath id="${id}-eye"><ellipse rx="36" ry="42"/></clipPath>
    <clipPath id="${id}-head"><path d="${HEAD}"/></clipPath>
    <linearGradient id="${id}-desk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4A39B8"/><stop offset=".5" stop-color="#32248A"/><stop offset="1" stop-color="#241A66"/></linearGradient>
    <linearGradient id="${id}-led" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.teal}"/><stop offset=".5" stop-color="${C.hot}"/><stop offset="1" stop-color="${C.yellow}"/></linearGradient>
    <radialGradient id="${id}-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#8E7BFF" stop-opacity=".55"/><stop offset="1" stop-color="#8E7BFF" stop-opacity="0"/></radialGradient>
  </defs>
  <ellipse cx="300" cy="250" rx="300" ry="250" fill="url(#${id}-glow)"/>

  <g transform="translate(300 470)"><g class="tc-jump"><g transform="translate(-300 -470)">
    <g transform="translate(404 440)"><g class="tc-tail">
      <path d="M0 0 C66 4 118 -26 120 -94 C121 -138 102 -158 84 -168" fill="none" stroke="${C.fur}" stroke-width="38" stroke-linecap="round"/>
      <path d="M73 -35 L95 -5 M96 -65 L130 -51 M102 -95 L138 -93" stroke="${C.furD}" stroke-width="11"/>
      <path d="M114 -134 C108 -152 98 -160 84 -168" fill="none" stroke="${C.cream}" stroke-width="38" stroke-linecap="round"/>
    </g></g>
    <g transform="translate(300 470)"><g class="tc-body">
      <path d="M-78 -172 C-104 -140 -116 -80 -112 0 L112 0 C116 -80 104 -140 78 -172 Z" fill="${C.furS}"/>
      <ellipse cx="0" cy="-74" rx="56" ry="74" fill="${C.cream}"/>
      <ellipse cx="0" cy="-160" rx="84" ry="18" fill="#B85A14" opacity=".32"/>
      <path d="M-70 -160 Q0 -122 70 -160" fill="none" stroke="${C.teal}" stroke-width="18" stroke-linecap="round"/>
      <g class="tc-costume tc-detective">
        <path d="M-82 -159 Q-104 -138 -104 -58 H104 Q104 -139 82 -159 L0 -113Z" fill="#466652"/>
        <path d="m-78 -158 54 13 23 33-49-13 13-14zm156 0-54 13-23 33 49-13-13-14z" fill="#A7BD85"/>
      </g>
      <g class="tc-costume tc-dj">
        <path d="M-79 -160 Q-106 -143 -107 -59 H107 Q106 -141 79 -160 L0 -112Z" fill="#5046B0"/>
        <path d="M-80 -154 -32 -118 -52 -113 -90 -141M80 -154 32 -118 52 -113 90 -141" fill="#66F5DA"/>
        <path d="M-3 -113H3V-58H-3z" fill="#D8D7FF"/>
      </g>
      <circle cx="0" cy="-128" r="13" fill="${C.yellow}" stroke="#E3A921" stroke-width="3"/>
    </g></g>
    <g transform="translate(300 304)"><g class="tc-head-emo"><g class="tc-head-gest"><g class="tc-head-look"><g class="tc-head-bob"><g class="tc-head-pop"><g transform="translate(-300 -304)">
      <g class="tc-ear-l" transform="translate(216 118)"><g class="tc-ear-emo"><g class="tc-ear">
        <path d="M-50 26 L-52 -94 L50 -34 Z" fill="${C.fur}" stroke="${C.fur}" stroke-width="14" stroke-linejoin="round"/>
        <path d="M-34 8 L-38 -66 L24 -30 Z" fill="${C.ear}" stroke="${C.ear}" stroke-width="8" stroke-linejoin="round"/>
      </g></g></g>
      <g class="tc-ear-r" transform="translate(384 118)"><g class="tc-ear-emo"><g class="tc-ear">
        <path d="M50 26 L52 -94 L-50 -34 Z" fill="${C.fur}" stroke="${C.fur}" stroke-width="14" stroke-linejoin="round"/>
        <path d="M34 8 L38 -66 L-24 -30 Z" fill="${C.ear}" stroke="${C.ear}" stroke-width="8" stroke-linejoin="round"/>
      </g></g></g>
      <path d="${HEAD}" fill="${C.fur}"/>
      <g clip-path="url(#${id}-head)">
        <ellipse cx="300" cy="352" rx="200" ry="92" fill="${C.furD}" opacity=".3"/>
        <ellipse cx="238" cy="112" rx="96" ry="40" fill="${C.furL}" opacity=".45"/>
      </g>
      <path d="M290 86 Q300 81 310 86 L305 124 Q300 130 295 124 Z M256 94 Q264 89 273 92 L273 121 Q268 127 264 121 Z M344 94 Q336 89 327 92 L327 121 Q332 127 336 121 Z" fill="${C.furD}"/>
      <g class="tc-chin"><path d="M300 238 C319 238 341 247 341 261 C341 276 315 291 300 293 C285 291 259 276 259 261 C259 247 281 238 300 238 Z" fill="${C.cream}"/></g>
      ${eye('l', 244, id)}${eye('r', 356, id)}
      <g transform="translate(244 136)"><path class="tc-brow tc-brow-l" d="M-25 4 Q-2 -10 25 1" fill="none" stroke="#B85A17" stroke-width="9" stroke-linecap="round"/></g>
      <g transform="translate(356 136)"><path class="tc-brow tc-brow-r" d="M25 4 Q2 -10 -25 1" fill="none" stroke="#B85A17" stroke-width="9" stroke-linecap="round"/></g>
      <g transform="translate(300 262)"><g class="tc-mouth-shape">
        <g transform="translate(0 4)"><g class="tc-mouth-open"><path d="M-15 0 Q0 -3 15 0 Q16 32 0 32 Q-16 32 -15 0 Z" fill="${C.mouth}"/><ellipse cx="0" cy="24" rx="9" ry="6" fill="${C.tongue}"/></g></g>
        <g transform="translate(0 1)"><g class="tc-mouth-smile"><path d="M-27 0 Q0 9 27 0 Q26 36 0 36 Q-26 36 -27 0 Z" fill="${C.mouth}"/><ellipse cx="0" cy="27" rx="14" ry="8" fill="${C.tongue}"/></g></g>
        <g transform="translate(0 14)"><ellipse class="tc-mouth-o" rx="12" ry="15" fill="${C.mouth}"/></g>
        <path class="tc-mouth-w" d="M-22 0 Q-11 13 0 0 Q11 13 22 0" fill="none" stroke="${C.ink}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path class="tc-mouth-sad" d="M-17 13 Q0 -3 17 13" fill="none" stroke="${C.ink}" stroke-width="5.5" stroke-linecap="round"/>
      </g></g>
      <path d="M300 250 L300 262" stroke="${C.ink}" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M287 236 Q300 230 313 236 Q310 250 300 252 Q290 250 287 236 Z" fill="${C.nose}"/>
      <ellipse cx="296" cy="238" rx="5" ry="2.4" fill="#fff" opacity=".55"/>
      <path d="M158 200 C158 20 442 20 442 200" fill="none" stroke="${C.navy}" stroke-width="21" stroke-linecap="round"/>
      <path d="M158 200 C158 20 442 20 442 200" fill="none" stroke="${C.navyL}" stroke-width="5" stroke-linecap="round" stroke-dasharray="118 2000" stroke-dashoffset="-128"/>
      <rect x="166" y="158" width="23" height="92" rx="11.5" fill="${C.hot}"/><rect x="411" y="158" width="23" height="92" rx="11.5" fill="${C.hot}"/>
      <rect x="121" y="150" width="59" height="108" rx="28" fill="${C.navy}"/><rect x="420" y="150" width="59" height="108" rx="28" fill="${C.navy}"/>
      <ellipse cx="150" cy="204" rx="14" ry="32" fill="${C.navyL}"/><ellipse cx="450" cy="204" rx="14" ry="32" fill="${C.navyL}"/>
      <circle cx="150" cy="204" r="9" fill="${C.yellow}"/><circle cx="450" cy="204" r="9" fill="${C.yellow}"/>
      <path d="M148 250 C148 285 164 303 192 304" fill="none" stroke="${C.navy}" stroke-width="7" stroke-linecap="round"/>
      <rect x="187" y="296" width="33" height="16" rx="8" fill="${C.navy}"/>
      <path d="M205 300v8m5-8v8" stroke="${C.teal}" stroke-width="2" stroke-linecap="round"/>
      <g class="tc-costume tc-detective" stroke-linejoin="round">
        <path d="M197 112 Q203 65 263 48 Q290 29 327 41 Q387 45 403 96 L387 119 Q312 95 225 121Z" fill="#779579" stroke="#263F39" stroke-width="6"/>
        <path d="M224 96 Q267 57 303 47 Q336 53 365 88M286 49Q268 71 266 93" fill="none" stroke="#ABC5A0" stroke-width="5"/>
        <path d="M191 113Q291 73 407 98 Q430 105 415 116 L343 120Q267 111 211 126Z" fill="#384C46" stroke="#243A34" stroke-width="5"/>
        <path class="tc-monocle-glint" d="M332 181 Q337 168 352 165 M335 191l15-17" stroke="#fff5cf" stroke-width="5" fill="none" stroke-linecap="round" opacity="0"/>
        <circle cx="356" cy="196" r="42" fill="none" stroke="#FFE5A3" stroke-width="5"/>
        <path d="M394 211Q413 256 388 278" fill="none" stroke="#FFDA90" stroke-width="3"/>
      </g>
      <g class="tc-costume tc-dj">
        <path d="M176 130Q196 65 292 54Q360 44 403 89L415 113Q344 92 264 111L206 146Z" fill="#7168DF" stroke="#352B76" stroke-width="6"/>
        <path d="M200 131Q295 77 411 107L471 138Q478 149 451 151L380 139Q305 116 210 148Z" fill="#32285F" stroke="#7DEDDC" stroke-width="6"/>
        <path d="m277 84 9 -12 -1 9 12 -2 -18 15 4 -10z" fill="#B6FFDF"/>
        <g stroke="#71F4DA" stroke-width="4" stroke-linecap="round">
          <path d="M137 199v9m7-19v29m8-38v48m8-39v31m277-20v9m7-20v29m8-38v48m8-39v31"/>
        </g>
      </g>
      <g transform="translate(244 268)"><g class="tc-wh tc-wh-l"><path d="M0 -8 L-84 -24 M-3 0 L-94 4 M0 8 L-82 32" stroke="#FFF8EC" stroke-width="4" stroke-linecap="round"/></g></g>
      <g transform="translate(356 268)"><g class="tc-wh tc-wh-r"><path d="M0 -8 L84 -24 M3 0 L94 4 M0 8 L82 32" stroke="#FFF8EC" stroke-width="4" stroke-linecap="round"/></g></g>
    </g></g></g></g></g></g></g>
    <g>
      <g transform="translate(104 104)"><path class="tc-x tc-x-spark" d="${STAR}" fill="${C.yellow}"/></g>
      <g transform="translate(500 84) scale(1.3)"><path class="tc-x tc-x-spark tc-d2" d="${STAR}" fill="${C.yellow}"/></g>
      <g transform="translate(518 196) scale(.8)"><path class="tc-x tc-x-spark tc-d3" d="${STAR}" fill="#fff"/></g>
    </g>
    <g>
      <g transform="translate(106 150) scale(1.3)"><path class="tc-x tc-x-heart" d="${HEART}" fill="${C.hot}"/></g>
      <g transform="translate(498 126) scale(1.6)"><path class="tc-x tc-x-heart tc-d2" d="${HEART}" fill="${C.hot}"/></g>
      <g transform="translate(300 40) scale(1.1)"><path class="tc-x tc-x-heart tc-d3" d="${HEART}" fill="#FF8FB0"/></g>
    </g>
    <g transform="translate(486 70)">
      <circle class="tc-x tc-x-dot" cx="0" cy="0" r="9" fill="#fff"/><circle class="tc-x tc-x-dot" cx="27" cy="-10" r="11" fill="#fff"/><circle class="tc-x tc-x-dot" cx="60" cy="-22" r="13" fill="#fff"/>
    </g>
    <g stroke="${C.yellow}" stroke-width="9" stroke-linecap="round">
      <g transform="translate(300 2)"><path class="tc-x tc-x-line" d="M0 0 L0 -34"/></g>
      <g transform="translate(206 12) rotate(-28)"><path class="tc-x tc-x-line" d="M0 0 L0 -28"/></g>
      <g transform="translate(394 12) rotate(28)"><path class="tc-x tc-x-line" d="M0 0 L0 -28"/></g>
    </g>
    <g transform="translate(214 244)"><path class="tc-x tc-x-tear" d="${DROP}" fill="#8FD8FF"/></g>
  </g></g></g>

  <g class="tc-desk">
    <rect x="6" y="386" width="588" height="48" rx="18" fill="#7867EE"/>
    <rect x="16" y="390" width="568" height="12" rx="6" fill="#A093FF" opacity=".6"/>
    <path d="M22 428 H578 V640 H22 Z" fill="url(#${id}-desk)"/>
    <rect class="tc-led" x="22" y="428" width="556" height="10" fill="url(#${id}-led)"/>
    <rect x="56" y="466" width="488" height="146" rx="30" fill="#150E44" opacity=".5"/>
    <g class="tc-costume tc-detective">
      <path d="m424 388 34-31 102 13-24 30z" fill="#31493e"/>
      <path d="m431 384 29-24 88 12-18 20z" fill="#fff0ce"/>
      <path d="m466 368 51 7m-58 1 61 8" fill="none" stroke="#b5a68d" stroke-width="3"/>
      <path d="m526 370 20 13" stroke="#bc8d54" stroke-width="7" stroke-linecap="round"/>
      <ellipse cx="519" cy="366" rx="14" ry="8" fill="#a9d7c8" stroke="#4f6356" stroke-width="4"/>
    </g>
    <g class="tc-costume tc-dj">
      <path d="m417 390 19-39 121 8 12 37-5 10-146-6z" fill="#272640" stroke="#9276bd" stroke-width="3"/>
      <g transform="translate(470 374) scale(1 .5)"><circle r="34" fill="#161728" stroke="#6be2d4" stroke-width="3"/>
        <g class="tc-record"><path d="M-26 -4 Q-24 -20 -9 -24 M9 24Q25 18 26 4" stroke="#79748d" stroke-width="3" fill="none"/><circle r="10" fill="#f49caa"/></g>
      </g>
      <path d="m513 369 12 1m5 1 12 1m-33 9 12 1m7 1 12 1" stroke="#ffb783" stroke-width="6" stroke-linecap="round"/>
    </g>
    <g transform="translate(70 334)">
      <path class="tc-steam" d="M16 -8 C10 -18 22 -24 16 -36" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
      <path class="tc-steam tc-steam2" d="M34 -8 C28 -18 40 -24 34 -36" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
      <path d="M4 14 C-20 14 -20 42 4 42" fill="none" stroke="${C.cream}" stroke-width="9"/>
      <rect x="0" y="0" width="52" height="56" rx="11" fill="${C.cream}"/>
      <rect x="0" y="0" width="52" height="11" rx="5.5" fill="${C.creamD}"/>
      <g transform="translate(26 33)"><path d="${HEART}" fill="${C.hot}" transform="scale(.62)"/></g>
    </g>
  </g>

  <g transform="translate(300 470)"><g class="tc-jump"><g transform="translate(-300 -470)">
    <g transform="translate(226 338)">${arm('l')}</g>
    <g transform="translate(374 338)">${arm('r')}</g>
    <g transform="translate(300 330) scale(2.4)"><path class="tc-heart-pop" d="${HEART}" fill="${C.hot}" stroke="#fff" stroke-width="1.2"/></g>
  </g></g></g>
</svg>`;
}

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const rnd = (a, b) => a + Math.random() * (b - a);

export function createHost(el) {
  injectStyle();
  const id = 'tc' + Math.random().toString(36).slice(2, 8);
  el.innerHTML = markup(id);
  const root = el.querySelector('svg');
  const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
  const pupils = $$('.tc-pupil'), look = $('.tc-head-look'), ears = $$('.tc-ear'), chin = $('.tc-chin');
  const mOpen = $('.tc-mouth-open'), mSmile = $('.tc-mouth-smile'), mO = $('.tc-mouth-o');
  let emotion = 'neutral', levelFn = null, open = 0, raf = 0, gestureTimer = 0, popTimer = 0, disposed = false;
  let lookX = 0, lookHeld = false;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!disposed) fn(); }, ms); timers.add(t); return t; };

  function applyLook() {
    const think = emotion === 'think';
    const px = think ? 7 : lookX * 8, py = think ? -9 : emotion === 'sad' ? 5 : -Math.abs(lookX) * 1.5;
    for (const p of pupils) p.style.transform = `translate(${px.toFixed(1)}px,${py.toFixed(1)}px)`;
    look.style.transform = `rotate(${(lookX * 2.6).toFixed(2)}deg) translateX(${(lookX * 4).toFixed(1)}px)`;
  }
  function applyEmotion(next) {
    if (next === emotion) return;
    emotion = next; root.dataset.emo = next; applyLook();
    root.classList.remove('tc-pop'); void root.getBoundingClientRect(); root.classList.add('tc-pop');
    clearTimeout(popTimer); popTimer = setTimeout(() => root.classList.remove('tc-pop'), 460);
  }
  function applyMouth(o) {
    mOpen.style.transform = `scale(${(0.85 + o * 0.25).toFixed(3)},${o.toFixed(3)})`;
    mSmile.style.transform = `scale(${(1 + o * 0.06).toFixed(3)},${(0.6 + o * 0.5).toFixed(3)})`;
    mO.style.transform = `scale(${(0.85 + o * 0.45).toFixed(3)})`;
    chin.style.transform = `translateY(${(o * 5).toFixed(2)}px)`;
  }
  function frame() {
    raf = 0; if (disposed) return;
    const target = levelFn ? clamp(Number(levelFn()) || 0) : 0;
    open += (target - open) * (target > open ? 0.6 : 0.3);
    if (!levelFn && open < 0.012) { open = 0; applyMouth(0); return; }
    applyMouth(open);
    raf = requestAnimationFrame(frame);
  }
  function blinkLoop() {
    later(() => {
      root.classList.add('tc-blink');
      later(() => root.classList.remove('tc-blink'), 120);
      if (Math.random() < 0.18) later(() => { root.classList.add('tc-blink'); later(() => root.classList.remove('tc-blink'), 110); }, 280);
      blinkLoop();
    }, rnd(2200, 5200));
  }
  function earLoop() {
    later(() => {
      const e = ears[Math.random() < 0.5 ? 0 : 1];
      e.classList.remove('tc-twitch'); void e.getBoundingClientRect(); e.classList.add('tc-twitch');
      later(() => e.classList.remove('tc-twitch'), 500);
      earLoop();
    }, rnd(3200, 7500));
  }
  function glanceLoop() {
    later(() => {
      if (!lookHeld) { lookX = Math.random() < 0.35 ? 0 : rnd(-0.9, 0.9); applyLook(); later(() => { if (!lookHeld) { lookX = 0; applyLook(); } }, rnd(700, 1500)); }
      glanceLoop();
    }, rnd(2600, 6000));
  }
  applyLook(); blinkLoop(); earLoop(); glanceLoop();

  return {
    el,
    setLook(value) { root.dataset.look = ['detective', 'dj'].includes(value) ? value : 'classic'; },
    get emotion() { return emotion; },
    setEmotion(name) { applyEmotion(EMOTIONS.includes(name) ? name : 'neutral'); },
    gesture(name) {
      if (!GESTURES[name]) return;
      for (const g of Object.keys(GESTURES)) root.classList.remove('tc-g-' + g);
      void root.getBoundingClientRect();
      root.classList.add('tc-g-' + name);
      clearTimeout(gestureTimer);
      gestureTimer = setTimeout(() => root.classList.remove('tc-g-' + name), GESTURES[name] + 60);
    },
    talk(fn) {
      levelFn = typeof fn === 'function' ? fn : null;
      if (!raf) raf = requestAnimationFrame(frame);
    },
    lookAt(x) {
      if (x === null || x === undefined) { lookHeld = false; lookX = 0; } else { lookHeld = true; lookX = clamp(Number(x) || 0, -1, 1); }
      applyLook();
    },
    dispose() {
      disposed = true; for (const t of timers) clearTimeout(t); timers.clear();
      clearTimeout(gestureTimer); clearTimeout(popTimer); if (raf) cancelAnimationFrame(raf);
    },
  };
}
