// Safe formatting for direct messages.
//
// Messages are stored as the text the sender typed. This turns that text into
// HTML when it is shown, and is the only place message text becomes HTML:
//   - Markdown: **bold**, *italic*, ~~strike~~, `code`, ```code blocks```,
//     > quotes, - lists, 1. lists, [links](https://...) and plain links.
//   - HTML-style tags people type: <b>, <i>, <s>, <code>, <br> work as the
//     markdown versions; <script> and friends (and everything inside them)
//     are dropped; any other known HTML tag is dropped but its text stays.
//     Text inside `code` is always shown exactly as typed.
//   - :emoji: shortcodes such as :thumbsup: or :fire:.
//   - GIFs and images: a direct image link (or ![alt](link)) from Tenor,
//     Giphy, Imgur or Discord shows inline. Anything else stays a plain link.
// Everything is escaped before any formatting is added, links must be
// http(s), and images are limited to a few trusted hosts.

(function (root) {
  'use strict';

  // ===== Emoji =====
  // name=emoji pairs. Names follow the common GitHub/Slack/Discord shortcodes.
  const EMOJI_SOURCE = `
    +1=👍 thumbsup=👍 thumbs_up=👍 -1=👎 thumbsdown=👎 thumbs_down=👎 ok_hand=👌 v=✌️ crossed_fingers=🤞 fingers_crossed=🤞
    point_up=☝️ point_down=👇 point_left=👈 point_right=👉 raised_hand=✋ wave=👋 clap=👏 raised_hands=🙌 open_hands=👐 pray=🙏
    handshake=🤝 muscle=💪 fist=✊ punch=👊 facepalm=🤦 shrug=🤷 writing_hand=✍️ nail_care=💅 ear=👂 nose=👃 eyes=👀 eye=👁️
    brain=🧠 tongue=👅 lips=👄 bone=🦴 tooth=🦷
    smile=😄 smiley=😃 grinning=😀 grin=😁 laughing=😆 satisfied=😆 sweat_smile=😅 joy=😂 rofl=🤣 slightly_smiling_face=🙂
    upside_down_face=🙃 wink=😉 blush=😊 innocent=😇 relaxed=☺️ heart_eyes=😍 star_struck=🤩 kissing_heart=😘 kissing=😗
    yum=😋 stuck_out_tongue=😛 stuck_out_tongue_winking_eye=😜 zany_face=🤪 money_mouth_face=🤑 hugs=🤗 thinking=🤔
    shushing_face=🤫 zipper_mouth_face=🤐 neutral_face=😐 expressionless=😑 no_mouth=😶 smirk=😏 unamused=😒 roll_eyes=🙄
    grimacing=😬 relieved=😌 pensive=😔 sleepy=😪 sleeping=😴 mask=😷 nauseated_face=🤢 sneezing_face=🤧 hot_face=🥵 cold_face=🥶
    dizzy_face=😵 exploding_head=🤯 cowboy_hat_face=🤠 partying_face=🥳 sunglasses=😎 nerd_face=🤓 monocle_face=🧐 confused=😕
    worried=😟 slightly_frowning_face=🙁 frowning=☹️ open_mouth=😮 hushed=😯 astonished=😲 flushed=😳 pleading_face=🥺
    fearful=😨 cold_sweat=😰 cry=😢 sob=😭 scream=😱 confounded=😖 persevere=😣 disappointed=😞 sweat=😓 weary=😩 tired_face=😫
    yawning_face=🥱 triumph=😤 rage=😡 angry=😠 cursing_face=🤬 smiling_imp=😈 imp=👿 skull=💀 skull_and_crossbones=☠️
    poop=💩 hankey=💩 clown_face=🤡 ghost=👻 alien=👽 space_invader=👾 robot=🤖 see_no_evil=🙈 hear_no_evil=🙉 speak_no_evil=🙊
    heart=❤️ red_heart=❤️ orange_heart=🧡 yellow_heart=💛 green_heart=💚 blue_heart=💙 purple_heart=💜 black_heart=🖤
    white_heart=🤍 brown_heart=🤎 broken_heart=💔 two_hearts=💕 revolving_hearts=💞 heartbeat=💓 heartpulse=💗 sparkling_heart=💖
    cupid=💘 gift_heart=💝 heart_exclamation=❣️ kiss=💋 love_letter=💌
    fire=🔥 100=💯 sparkles=✨ star=⭐ star2=🌟 dizzy=💫 zap=⚡ boom=💥 collision=💥 tada=🎉 confetti_ball=🎊 balloon=🎈 gift=🎁
    trophy=🏆 medal=🏅 first_place_medal=🥇 second_place_medal=🥈 third_place_medal=🥉 crown=👑 gem=💎 ribbon=🎀
    rocket=🚀 airplane=✈️ car=🚗 bike=🚲 ship=🚢 train=🚆 bulb=💡 warning=⚠️ no_entry=⛔ stop_sign=🛑 construction=🚧
    white_check_mark=✅ check=✅ heavy_check_mark=✔️ x=❌ negative_squared_cross_mark=❎ question=❓ grey_question=❔
    exclamation=❗ bangbang=‼️ heavy_plus_sign=➕ heavy_minus_sign=➖ arrow_up=⬆️ arrow_down=⬇️ arrow_left=⬅️ arrow_right=➡️
    recycle=♻️ infinity=♾️ copyright=©️ tm=™️ new=🆕 free=🆓 cool=🆒 ok=🆗 sos=🆘 up=🆙
    hourglass=⌛ stopwatch=⏱️ alarm_clock=⏰ watch=⌚ calendar=📅 bell=🔔 no_bell=🔕 lock=🔒 unlock=🔓 key=🔑 mag=🔍
    link=🔗 paperclip=📎 pushpin=📌 scissors=✂️ pencil=✏️ pencil2=✏️ memo=📝 book=📖 books=📚 bookmark=🔖 email=📧
    envelope=✉️ inbox_tray=📥 outbox_tray=📤 package=📦 mailbox=📫 clipboard=📋 chart_with_upwards_trend=📈 bar_chart=📊
    computer=💻 desktop_computer=🖥️ keyboard=⌨️ iphone=📱 phone=☎️ battery=🔋 electric_plug=🔌 floppy_disk=💾 cd=💿
    video_game=🎮 joystick=🕹️ game_die=🎲 jigsaw=🧩 dart=🎯 art=🎨 headphones=🎧 microphone=🎤 musical_note=🎵 notes=🎶
    guitar=🎸 camera=📷 video_camera=📹 movie_camera=🎥 clapper=🎬 tv=📺 radio=📻 satellite=📡 telescope=🔭 microscope=🔬
    hammer=🔨 wrench=🔧 gear=⚙️ nut_and_bolt=🔩 magnet=🧲 bomb=💣 pick=⛏️ axe=🪓 crossed_swords=⚔️ dagger=🗡️ shield=🛡️
    bow_and_arrow=🏹 bricks=🧱 test_tube=🧪 pill=💊 shopping_cart=🛒 moneybag=💰 dollar=💵 credit_card=💳 chains=⛓️
    sunny=☀️ sun_with_face=🌞 partly_sunny=⛅ cloud=☁️ rain_cloud=🌧️ thunder_cloud_and_rain=⛈️ snowflake=❄️ snowman=⛄
    umbrella=☂️ rainbow=🌈 ocean=🌊 droplet=💧 comet=☄️ moon=🌙 full_moon=🌕 earth_africa=🌍 earth_americas=🌎 globe_with_meridians=🌐
    tree=🌳 evergreen_tree=🌲 palm_tree=🌴 seedling=🌱 herb=🌿 four_leaf_clover=🍀 maple_leaf=🍁 cactus=🌵 mushroom=🍄
    rose=🌹 sunflower=🌻 tulip=🌷 cherry_blossom=🌸 bouquet=💐 hibiscus=🌺 volcano=🌋 mountain=⛰️ desert=🏜️ camping=🏕️
    dog=🐶 cat=🐱 mouse=🐭 hamster=🐹 rabbit=🐰 fox_face=🦊 bear=🐻 panda_face=🐼 koala=🐨 tiger=🐯 lion=🦁 cow=🐮 pig=🐷
    frog=🐸 monkey_face=🐵 monkey=🐒 chicken=🐔 penguin=🐧 bird=🐦 eagle=🦅 duck=🦆 owl=🦉 bat=🦇 wolf=🐺 horse=🐴 unicorn=🦄
    bee=🐝 bug=🐛 butterfly=🦋 snail=🐌 spider=🕷️ scorpion=🦂 turtle=🐢 snake=🐍 dragon=🐉 t_rex=🦖 whale=🐳 dolphin=🐬
    fish=🐟 tropical_fish=🐠 shark=🦈 octopus=🐙 crab=🦀 paw_prints=🐾
    pizza=🍕 hamburger=🍔 fries=🍟 hotdog=🌭 taco=🌮 burrito=🌯 popcorn=🍿 sushi=🍣 ramen=🍜 spaghetti=🍝 egg=🥚 bacon=🥓
    bread=🍞 cheese=🧀 cake=🍰 birthday=🎂 cookie=🍪 doughnut=🍩 chocolate_bar=🍫 candy=🍬 lollipop=🍭 ice_cream=🍨
    icecream=🍦 coffee=☕ tea=🍵 milk_glass=🥛 beer=🍺 beers=🍻 wine_glass=🍷 cocktail=🍸 champagne=🍾 cup_with_straw=🥤
    apple=🍎 green_apple=🍏 banana=🍌 grapes=🍇 watermelon=🍉 strawberry=🍓 cherries=🍒 peach=🍑 pineapple=🍍 avocado=🥑
    carrot=🥕 corn=🌽 potato=🥔 pumpkin=🎃 tomato=🍅 lemon=🍋 orange=🍊 coconut=🥥 kiwi=🥝 melon=🍈
    soccer=⚽ basketball=🏀 football=🏈 baseball=⚾ tennis=🎾 volleyball=🏐 golf=⛳ boxing_glove=🥊 ping_pong=🏓 skateboard=🛹
    house=🏠 school=🏫 hospital=🏥 castle=🏰 tent=⛺ ferris_wheel=🎡 roller_coaster=🎢 flags=🎏 checkered_flag=🏁
    white_flag=🏳️ rainbow_flag=🏳️‍🌈 pirate_flag=🏴‍☠️ man=👨 woman=👩 baby=👶 older_man=👴 older_woman=👵 santa=🎅 ninja=🥷
    detective=🕵️ astronaut=🧑‍🚀 mage=🧙 vampire=🧛 zombie=🧟 fairy=🧚 angel=👼 100_percent=💯 hundred=💯 zzz=💤 sweat_drops=💦
    dash=💨 speech_balloon=💬 thought_balloon=💭 anger=💢 hole=🕳️ mag_right=🔎 loudspeaker=📢 mega=📣 postal_horn=📯
  `;
  const EMOJI = Object.create(null);
  for (const pair of EMOJI_SOURCE.split(/\s+/)) {
    const i = pair.indexOf('=');
    if (i > 0) EMOJI[pair.slice(0, i)] = pair.slice(i + 1);
  }

  // Shown in the composer's emoji picker.
  const PICKER = ['😀', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😅', '😭', '😡', '🥺', '👍', '👎', '👏', '🙏', '💪', '👀', '🔥', '✨', '❤️', '💔',
    '🎉', '💯', '✅', '❌', '⚡', '🚀', '⭐', '🎮', '⛏️', '🧱', '💎', '🗡️', '🛡️', '🏹', '😴', '🤝', '👋', '🙌'];

  const emojify = (s) => s.replace(/:([a-z0-9_+-]{1,32}):/gi, (m, name) => EMOJI[name.toLowerCase()] || m);

  // ===== Escaping and URLs =====

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

  // Images and GIFs only load from these hosts.
  const IMAGE_HOST = /^(?:(?:media|media\d|c|i)\.(?:tenor|giphy)\.com|i\.imgur\.com|(?:cdn|media)\.discordapp\.(?:com|net))$/i;
  const IMAGE_PATH = /\.(?:gif|webp|png|jpe?g)$/i;
  const MAX_IMAGES = 3;

  function parseUrl(raw) {
    try {
      const u = new URL(raw);
      if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null;
      return u;
    } catch (e) {
      return null;
    }
  }
  const isEmbeddable = (u) => IMAGE_HOST.test(u.hostname) && IMAGE_PATH.test(u.pathname);

  const REL = 'noopener noreferrer nofollow ugc';
  const linkHtml = (href, inner) => `<a href="${esc(href)}" target="_blank" rel="${REL}">${inner}</a>`;
  const imageHtml = (href, alt) =>
    `<a class="dm-gif-link" href="${esc(href)}" target="_blank" rel="${REL}">` +
    `<img class="dm-gif" src="${esc(href)}" alt="${esc(alt || 'GIF')}" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a>`;

  // ===== HTML-ish tags people type =====

  const KNOWN_TAGS = ('a abbr acronym address applet area article aside audio b base basefont bdi bdo big blockquote body br button canvas ' +
    'caption center cite code col colgroup data datalist dd del details dfn dialog dir div dl dt em embed fieldset figcaption figure font ' +
    'footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html i iframe img input ins kbd label legend li link listing main map ' +
    'mark marquee math menu meta meter nav noscript object ol optgroup option output p param picture plaintext pre progress q rp rt ' +
    'ruby s samp script section select slot small source span strike strong style sub summary sup svg table tbody td template textarea ' +
    'tfoot th thead time title tr track tt u ul var video wbr xmp').split(' ');
  const ANY_TAG = new RegExp(`</?(?:${KNOWN_TAGS.join('|')})(?=[\\s/>])[^>]*>`, 'gi');
  const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|template|noscript|textarea|svg|math|title|head|xmp|plaintext|applet|frameset|frame)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
  const DROP_TO_END = /<(?:script|style|iframe|object|embed|textarea)\b[^>]*>[\s\S]*$/gi;

  // Removing a tag can join the pieces around it into a new one
  // (<scr<script></script>ipt>), so repeat until nothing changes.
  function dropDangerous(s, space) {
    for (let n = 0; n < 5; n++) {
      const next = s.replace(/<!--[\s\S]*?-->/g, space).replace(DROP_WITH_CONTENT, space).replace(DROP_TO_END, space);
      if (next === s) break;
      s = next;
    }
    return s;
  }

  function tagsToMarkdown(s, store) {
    return dropDangerous(s, '')
      .replace(/<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi, (m, inner) => store('inline', `<code>${esc(inner.replace(ANY_TAG, ''))}</code>`))
      .replace(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi, (m, d, sq, inner) => {
        const href = (d != null ? d : sq).trim().replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20');
        return `[${inner.replace(ANY_TAG, '')}](${href})`;
      })
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|h[1-6]|tr|blockquote)\s*>/gi, '\n')
      .replace(/<\/?(?:b|strong)(?=[\s/>])[^>]*>/gi, '**')
      .replace(/<\/?(?:i|em)(?=[\s/>])[^>]*>/gi, '*')
      .replace(/<\/?(?:s|strike|del)(?=[\s/>])[^>]*>/gi, '~~')
      .replace(ANY_TAG, '');
  }

  // ===== Inline formatting (works on escaped text) =====

  function inline(s, ctx) {
    const hold = (html) => ctx.store('inline', html);

    // Images and links first, so their addresses are never touched by the rules below.
    s = s.replace(/!\[([^\]\n]*)\]\(([^()\s]+)\)/g, (m, alt, url) => {
      const u = parseUrl(unesc(url));
      if (!u) return m;
      if (isEmbeddable(u) && ctx.images < MAX_IMAGES) { ctx.images++; return hold(imageHtml(u.href, unesc(alt))); }
      return hold(linkHtml(u.href, emojify(esc(u.href))));
    });
    s = s.replace(/\[([^\]\n]+)\]\(([^()\s]+)\)/g, (m, text, url) => {
      const u = parseUrl(unesc(url));
      return u ? hold(linkHtml(u.href, format(text))) : m;
    });
    s = s.replace(/https?:\/\/[^\s<]+/g, (m) => {
      let raw = unesc(m);
      const trimmed = raw.replace(/[.,;:!?)\]'"<>*_~]+$/, '');
      const u = parseUrl(trimmed);
      if (!u) return m;
      const tail = esc(raw.slice(trimmed.length));
      if (isEmbeddable(u) && ctx.images < MAX_IMAGES) { ctx.images++; return hold(imageHtml(u.href, 'GIF')) + tail; }
      return hold(linkHtml(u.href, esc(trimmed))) + tail;
    });
    return format(s);
  }

  // Bold, italic, strike and emoji on text that has no links or code left in it.
  function format(s) {
    return emojify(s
      .replace(/\*\*(?=\S)([^\n]*?\S)\*\*(?!\*)/g, '<strong>$1</strong>')
      .replace(/(^|[^\w])__(?=\S)([^\n]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
      .replace(/~~([^~\s](?:[^~\n]*[^~\s])?)~~/g, '<s>$1</s>')
      .replace(/(^|[^*\w])\*([^*\s](?:[^*\n]*[^*\s])?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_([^_\s](?:[^_\n]*[^_\s])?)_(?!\w)/g, '$1<em>$2</em>'));
  }

  // ===== Blocks =====

  const QUOTE = /^&gt;\s?/;
  const BULLET = /^\s*[-*+]\s+/;
  const NUMBERED = /^\s*\d{1,3}[.)]\s+/;
  const BLOCK_TOKEN = /^\u0001\d+\u0001$/;

  function blocks(escaped, ctx) {
    const lines = escaped.split('\n');
    const out = [];
    let i = 0;
    const special = (l) => QUOTE.test(l) || BULLET.test(l) || NUMBERED.test(l) || BLOCK_TOKEN.test(l.trim());
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (BLOCK_TOKEN.test(line.trim())) { out.push(line.trim()); i++; continue; }
      if (QUOTE.test(line)) {
        const body = [];
        while (i < lines.length && QUOTE.test(lines[i])) body.push(lines[i++].replace(QUOTE, ''));
        out.push(`<blockquote>${body.map(l => inline(l, ctx)).join('<br>')}</blockquote>`);
      } else if (BULLET.test(line) || NUMBERED.test(line)) {
        const re = BULLET.test(line) ? BULLET : NUMBERED;
        const tag = re === BULLET ? 'ul' : 'ol';
        const items = [];
        while (i < lines.length && re.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(re, ''), ctx)}</li>`);
        out.push(`<${tag}>${items.join('')}</${tag}>`);
      } else {
        const para = [];
        while (i < lines.length && lines[i].trim() && !(para.length && special(lines[i]))) para.push(inline(lines[i++], ctx));
        out.push(`<div class="dm-p">${para.join('<br>')}</div>`);
      }
    }
    return out.join('');
  }

  // ===== Public API =====

  function makeContext() {
    const tokens = [];
    return {
      images: 0,
      tokens,
      // Inline pieces are held as \u0000N\u0000 and block pieces as \u0001N\u0001 until the end.
      store(kind, html) {
        tokens.push(html);
        const mark = kind === 'block' ? '\u0001' : '\u0000';
        return `${mark}${tokens.length - 1}${mark}`;
      }
    };
  }

  function restore(html, ctx) {
    for (let n = 0; n < 4 && /[\u0000\u0001]/.test(html); n++) {
      html = html.replace(/\u0000(\d+)\u0000|\u0001(\d+)\u0001/g, (m, a, b) => ctx.tokens[a != null ? a : b] || '');
    }
    return html.replace(/[\u0000\u0001]/g, '');
  }

  function render(raw) {
    const ctx = makeContext();
    let s = String(raw == null ? '' : raw).replace(/[\u0000\u0001]/g, '').replace(/\r\n?/g, '\n').slice(0, 4000);

    // Code is set aside first so nothing below touches it.
    s = s.replace(/```[a-zA-Z0-9_+-]*\n?([\s\S]*?)```/g, (m, code) => ctx.store('block', `<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`));
    s = s.replace(/`([^`\n]+)`/g, (m, code) => ctx.store('inline', `<code>${esc(code)}</code>`));

    s = tagsToMarkdown(s, ctx.store);
    return restore(blocks(esc(s), ctx), ctx);
  }

  // Plain one-line text for conversation previews.
  function preview(raw) {
    let s = String(raw == null ? '' : raw).replace(/[\u0000\u0001]/g, '').slice(0, 400);
    s = dropDangerous(s, ' ').replace(ANY_TAG, ' ');
    s = s.replace(/```[\s\S]*?```/g, ' code ');
    s = s.replace(/!\[[^\]\n]*\]\([^()\s]+\)/g, ' [GIF] ');
    s = s.replace(/\[([^\]\n]+)\]\([^()\s]+\)/g, '$1');
    s = s.replace(/https?:\/\/\S+/g, (m) => { const u = parseUrl(m); return u && isEmbeddable(u) ? '[GIF]' : m; });
    s = s.replace(/^\s*(?:>|[-*+]\s|\d{1,3}[.)]\s)/gm, '').replace(/[*_~`]+/g, '');
    return emojify(s).replace(/\s+/g, ' ').trim();
  }

  // Only a few emoji and nothing else: shown larger.
  function isEmojiOnly(raw) {
    const t = emojify(preview(raw));
    return /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*\s*){1,3}$/u.test(t);
  }

  const api = { render, preview, isEmojiOnly, EMOJI, PICKER };
  root.ChatFormat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
