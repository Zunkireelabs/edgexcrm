/*
 * Zunkiree Chat: a themeable website chat widget.
 *
 * One file, no build step, no dependencies. Styles live in a shadow root, so the host page's CSS cannot
 * leak in and ours cannot leak out. Everything a tenant or project may change is in the theme config
 * (colours, logo, wording, topics, links); the screens do not change per project.
 *
 * PROTOTYPE STATUS: the messages go to a built-in MOCK transport (scripted replies, kept in sessionStorage).
 * Nothing is sent to a server. A real transport (Chatwoot through EdgeX) plugs into `config.transport`
 * with the same three-method shape as MockTransport below.
 *
 * Usage:
 *   <script src="https://crm.example.com/chat-widget/chat-widget.js"></script>
 *   <script>ZunkireeChat.init({ brand: { name: "Admizz Education", logo: "/logo.webp" }, ... })</script>
 */
(function () {
  "use strict";
  if (window.ZunkireeChat) return;

  var DEFAULT_CONFIG = {
    brand: {
      name: "Our team",
      primary: "#001353", // header, visitor bubbles, links
      primaryDark: "#0D1282", // header gradient end
      accent: "#FDED22", // launcher, send button, accents (must be readable with `primary` text on it)
      logo: "", // a logo that reads on the primary colour (a white one); optional
    },
    greeting: "Hi there, how can we help?",
    startCard: { title: "Start a conversation", sub: "Ask us anything" },
    team: [{ initials: "A", color: "#31429C" }],
    agent: { name: "Our team", initials: "AE" },
    online: true,
    onlineTitle: "Our team is online",
    onlineSub: "Typically replies in a few minutes",
    offlineTitle: "Our team is away",
    offlineSub: "Leave a message and we will reply as soon as we can",
    topicsTitle: "Popular topics",
    topics: [],
    link: null, // { label, sub, url }: one highlighted action under the topics, for example "Book a consultation"
    composerPlaceholder: "Write a message…",
    // The short contact form that gives the team a way to reach the visitor (it becomes a lead).
    // when: "before" = ask first, and hold the visitor's message until the form is sent;
    //       "after"  = ask once, right after the first answer.
    // Each field can be hidden, and made required or optional, like the settings card in EdgeX.
    contact: {
      when: "after",
      introBefore: "Before we start, how can we reach you?",
      introAfter: "So a counsellor can follow up, share your details:",
      holdNote: "Add your details to send your message.",
      submit: "Share details",
      name: { show: true, required: true },
      phone: { show: true, required: true },
      email: { show: true, required: false },
    },
    poweredBy: "Zunkiree",
    zIndex: 2147483000,
    transport: null, // null = the built-in mock
  };

  var STORAGE_KEY = "zk-chat:v2";
  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // ---------------------------------------------------------------- small helpers
  function merge(base, extra) {
    var out = {};
    var k;
    for (k in base) out[k] = base[k];
    for (k in extra || {}) {
      var v = extra[k];
      out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k]) ? merge(base[k], v) : v;
    }
    return out;
  }

  /** Builds an element. Text always goes in as text (never HTML), so visitor input cannot inject markup. */
  function el(tag, props, kids) {
    var node = document.createElement(tag);
    var k;
    for (k in props || {}) {
      var v = props[k];
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    (kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function svg(paths, size, stroke, fill) {
    var ns = "http://www.w3.org/2000/svg";
    var s = document.createElementNS(ns, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("width", size || 20);
    s.setAttribute("height", size || 20);
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("fill", fill || "none");
    s.setAttribute("stroke", stroke || "currentColor");
    s.setAttribute("stroke-width", "2.2");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    paths.forEach(function (d) {
      var p = document.createElementNS(ns, "path");
      p.setAttribute("d", d);
      s.appendChild(p);
    });
    return s;
  }

  var ICON = {
    chat: ["M12 3C6.5 3 2 6.8 2 11.5c0 2.5 1.3 4.7 3.4 6.3L4.6 22l4.4-2.2c1 .3 2 .4 3 .4 5.5 0 10-3.8 10-8.7S17.5 3 12 3z"],
    close: ["M6 6l12 12M18 6L6 18"],
    arrow: ["M5 12h14M13 6l6 6-6 6"],
    back: ["M15 5l-7 7 7 7"],
    home: ["M4 11l8-7 8 7v9H4z"],
    msgs: ["M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"],
    link: ["M7 3v4M17 3v4M3.5 9h17M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"],
  };

  function clock(ts) {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return "";
    }
  }

  function uid() {
    return String(Date.now()) + Math.random().toString(36).slice(2, 7);
  }

  // ---------------------------------------------------------------- mock transport (prototype only)
  // Shape every transport must have:
  //   start(state, hooks)   called once; hooks = { agentTyping(bool), agentMessage({text, quick}) }
  //   send(text)            the visitor sent a message
  //   submitDetails(d)      the visitor shared { name, phone }
  function scriptedReply(text) {
    var t = text.toLowerCase();
    if (/\b(uk|united kingdom|britain|england)\b/.test(t)) {
      return { text: "Good choice. The UK is popular for postgraduate study. Which course are you thinking about, and when would you like to start?", quick: ["September intake", "January intake", "Not sure yet"] };
    }
    if (/\b(usa|us|america|united states)\b/.test(t)) {
      return { text: "Thanks for asking about the USA. Are you looking at a bachelor's or a master's, and do you have a subject in mind?", quick: ["Bachelor's", "Master's", "Not sure yet"] };
    }
    if (/canada|australia|new zealand|germany/.test(t)) {
      return { text: "Happy to help with that destination. Which level of study and which subject are you considering?", quick: ["Bachelor's", "Master's", "Not sure yet"] };
    }
    if (/scholarship|funding|fee/.test(t)) {
      return { text: "Scholarships and costs depend on the country, university and course. Tell us what you are aiming for and a counsellor will walk you through the options.", quick: ["Study in the UK", "Study in the USA", "Another country"] };
    }
    if (/visa/.test(t)) {
      return { text: "We can help with visa questions. Which country are you applying for?", quick: ["UK", "USA", "Canada", "Australia"] };
    }
    return { text: "Thanks for your message. A counsellor will take a look and reply here.", quick: [] };
  }

  function createMockTransport() {
    var hooks = null;
    var visitorMessages = 0;
    function later(fn, ms) {
      return window.setTimeout(fn, ms);
    }
    return {
      start: function (state, h) {
        hooks = h;
        visitorMessages = state.messages.filter(function (m) { return m.from === "visitor"; }).length;
      },
      send: function (text) {
        visitorMessages += 1;
        var reply = scriptedReply(text);
        later(function () { hooks.agentTyping(true); }, 350);
        later(function () {
          hooks.agentTyping(false);
          hooks.agentMessage(reply);
        }, 1700);
      },
      submitDetails: function (d) {
        later(function () { hooks.agentTyping(true); }, 300);
        later(function () {
          hooks.agentTyping(false);
          hooks.agentMessage({ text: "Thanks" + (d.name ? ", " + d.name : "") + ". A counsellor will " + (d.phone ? "message you on WhatsApp" : "email you") + " shortly.", quick: [] });
        }, 1300);
      },
    };
  }

  // ---------------------------------------------------------------- styles
  function styles(cfg) {
    var b = cfg.brand;
    return [
      ":host{all:initial}",
      "*{box-sizing:border-box;margin:0;padding:0}",
      ".zk{--primary:" + b.primary + ";--primary2:" + b.primaryDark + ";--accent:" + b.accent + ";--ink:#1B2235;--mute:#5C7189;--line:#E6E9F5;--soft:#F6F7FD;--green:#22C55E;",
      "  font-family:var(--font-montserrat,Montserrat),'Helvetica Neue',Arial,sans-serif;color:var(--ink);font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased}",
      "button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;text-align:inherit}",
      "button:focus-visible,a:focus-visible,textarea:focus-visible,input:focus-visible{outline:3px solid #7C8CFF;outline-offset:2px}",
      // launcher
      ".launcher{position:fixed;right:24px;bottom:var(--chat-bubble-bottom,24px);width:60px;height:60px;border-radius:50%;background:var(--accent);color:var(--primary);",
      "  display:flex;align-items:center;justify-content:center;z-index:" + cfg.zIndex + ";box-shadow:0 10px 26px rgba(0,19,83,.26),0 2px 6px rgba(0,19,83,.14);transition:transform .18s ease,box-shadow .18s ease}",
      ".launcher:hover{transform:translateY(-3px)}",
      ".launcher .ico-x{display:none}.zk.open .launcher .ico-chat{display:none}.zk.open .launcher .ico-x{display:block}",
      ".badge{position:absolute;top:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:#EF4444;border:2px solid #fff;display:none}.badge.on{display:block}",
      // panel
      ".panel{position:fixed;right:24px;bottom:var(--chat-window-bottom,100px);width:384px;height:min(640px,calc(100vh - var(--chat-window-bottom,100px) - 16px));",
      "  background:#fff;border-radius:26px;overflow:hidden;display:flex;flex-direction:column;z-index:" + cfg.zIndex + ";",
      "  box-shadow:0 26px 60px rgba(0,19,83,.28),0 4px 14px rgba(0,19,83,.12);opacity:0;visibility:hidden;transform:translateY(14px) scale(.98);transform-origin:bottom right;",
      "  transition:opacity .2s ease,transform .22s ease,visibility 0s linear .22s}",
      ".zk.open .panel{opacity:1;visibility:visible;transform:none;transition:opacity .2s ease,transform .22s ease}",
      "@media (max-width:667px){.panel{right:0;left:0;top:0;bottom:0;width:100%;height:100%;border-radius:0}.zk.open .launcher{display:none}}",
      "@media (prefers-reduced-motion:reduce){.panel,.launcher{transition:none}.typing i{animation:none}}",
      // home
      ".hero{background:linear-gradient(160deg,var(--primary) 0%,var(--primary2) 100%);color:#fff;padding:20px 22px 66px;position:relative;overflow:hidden;flex:none}",
      ".hero:after{content:'';position:absolute;right:-60px;top:-50px;width:200px;height:200px;border-radius:50%;background:radial-gradient(circle,rgba(253,237,34,.20),rgba(253,237,34,0) 68%);pointer-events:none}",
      ".hero>*{position:relative;z-index:1}",
      ".top{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;min-height:30px}",
      ".top img{height:26px;display:block;max-width:60%}.top .name{font-weight:700;font-size:16px}",
      ".xbtn{width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.16);color:#fff;display:flex;align-items:center;justify-content:center}.xbtn:hover{background:rgba(255,255,255,.26)}",
      ".hero h2{font-size:26px;line-height:1.15;font-weight:700;letter-spacing:-.2px}",
      ".team{display:flex;align-items:center;gap:10px;margin-top:16px}",
      ".stack{display:flex}.stack span{width:30px;height:30px;border-radius:50%;border:2px solid var(--primary);margin-left:-8px;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;color:#fff}.stack span:first-child{margin-left:0}",
      ".team small{font-size:12px;line-height:1.3;color:rgba(255,255,255,.9)}.team small b{display:block;font-weight:600}",
      ".dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);margin-right:6px;vertical-align:middle}.dot.off{background:#9AA3B5}",
      ".home{flex:1;overflow-y:auto;padding:0 16px 8px;margin-top:-40px;position:relative;z-index:2}",
      ".start{width:100%;background:#fff;border-radius:18px;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;box-shadow:0 10px 28px rgba(0,19,83,.14),0 0 0 1px rgba(0,19,83,.05);transition:transform .15s ease,box-shadow .15s ease}",
      ".start:hover{transform:translateY(-2px);box-shadow:0 14px 32px rgba(0,19,83,.18),0 0 0 1px rgba(0,19,83,.06)}",
      ".start b{display:block;font-size:15.5px}.start .sub{display:block;font-size:12.5px;color:var(--mute)}",
      ".arrow{width:38px;height:38px;border-radius:50%;background:var(--primary);color:var(--accent);display:flex;align-items:center;justify-content:center;flex:none}",
      ".sec{font-size:11.5px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:var(--mute);margin:18px 4px 9px}",
      ".chips{display:flex;flex-wrap:wrap;gap:8px}",
      ".chip{font-size:12.5px;font-weight:600;color:var(--primary);background:#fff;border:1.5px solid #DADFF3;border-radius:99px;padding:7px 13px;transition:background .15s,border-color .15s}.chip:hover{background:var(--soft);border-color:#B9C2EE}",
      ".linkrow{margin-top:14px;display:flex;align-items:center;gap:12px;background:var(--soft);border-radius:14px;padding:11px 13px;text-decoration:none;color:inherit;transition:background .15s}.linkrow:hover{background:#EEF0FB}",
      ".linkrow i{width:34px;height:34px;border-radius:10px;background:var(--accent);color:var(--primary);display:flex;align-items:center;justify-content:center;flex:none}",
      ".linkrow b{display:block;font-size:13.5px}.linkrow small{font-size:11.5px;color:var(--mute)}",
      // bottom nav + footer
      ".nav{display:flex;border-top:1px solid var(--line);background:#fff;flex:none}",
      ".nav button{flex:1;padding:9px 0 6px;text-align:center;font-size:11px;font-weight:600;color:#8B94A8;display:flex;flex-direction:column;align-items:center;gap:2px}.nav button.on{color:var(--primary)}",
      ".pw{text-align:center;font-size:10.5px;color:#9AA3B5;padding:0 0 9px;background:#fff;flex:none}",
      // messages list tab
      ".list{flex:1;overflow-y:auto;padding:20px 16px;background:#fff}",
      ".list h3{font-size:20px;font-weight:700;color:var(--ink);margin:2px 4px 14px}",
      ".convo{width:100%;display:flex;align-items:center;gap:12px;background:var(--soft);border-radius:16px;padding:13px 14px}.convo:hover{background:#EEF0FB}",
      ".av{width:38px;height:38px;border-radius:50%;background:var(--accent);color:var(--primary);font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;flex:none;position:relative}",
      ".av.on:after{content:'';position:absolute;right:-1px;bottom:-1px;width:11px;height:11px;border-radius:50%;background:var(--green);border:2px solid #fff}",
      ".convo b{display:block;font-size:13.5px}.convo small{display:block;font-size:12px;color:var(--mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:230px}",
      ".empty{text-align:center;color:var(--mute);padding:40px 20px}.empty b{display:block;color:var(--ink);font-size:15px;margin-bottom:4px}",
      ".btn{display:inline-block;margin-top:14px;background:var(--primary);color:#fff;font-weight:700;font-size:13px;padding:10px 18px;border-radius:99px}",
      // chat
      ".bar{background:linear-gradient(160deg,var(--primary),var(--primary2));color:#fff;padding:14px 14px 14px 10px;display:flex;align-items:center;gap:8px;flex:none}",
      ".bar .iconbtn{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff}.bar .iconbtn:hover{background:rgba(255,255,255,.16)}",
      ".bar .av{border:2px solid rgba(255,255,255,.0)}.bar .av.on:after{border-color:var(--primary)}",
      ".bar b{display:block;font-size:14.5px}.bar small{font-size:11.5px;opacity:.88}.bar .grow{flex:1;min-width:0}",
      ".msgs{flex:1;overflow-y:auto;background:var(--soft);padding:16px 14px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth}",
      ".day{align-self:center;font-size:11px;color:#8B94A8;font-weight:600}",
      ".row{display:flex;align-items:flex-end;gap:8px}.row.v{justify-content:flex-end}",
      ".row .av{width:26px;height:26px;font-size:10.5px}",
      ".m{max-width:78%;font-size:13.5px;line-height:1.42;padding:10px 13px;border-radius:18px;white-space:pre-wrap;overflow-wrap:anywhere}",
      ".m.a{background:#fff;color:var(--ink);border-bottom-left-radius:6px;box-shadow:0 1px 3px rgba(0,19,83,.08)}",
      ".m.v{background:var(--primary);color:#fff;border-bottom-right-radius:6px}",
      ".meta{font-size:10.5px;color:#8B94A8;margin:-4px 4px 0 34px}.meta.v{margin:-4px 4px 0 0;align-self:flex-end}",
      ".typing{display:inline-flex;gap:4px;background:#fff;border-radius:16px;border-bottom-left-radius:6px;padding:12px 14px;box-shadow:0 1px 3px rgba(0,19,83,.08);margin-left:34px;align-self:flex-start}",
      ".typing i{width:6px;height:6px;border-radius:50%;background:#9AA3B5;display:block;animation:zkb 1.2s infinite ease-in-out}.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}",
      "@keyframes zkb{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}",
      ".qr{display:flex;gap:7px;flex-wrap:wrap;margin-left:34px}.qr button{font-size:12px;font-weight:600;color:var(--primary);background:#fff;border:1.5px solid #CFD6F2;border-radius:99px;padding:6px 12px}.qr button:hover{background:#F0F2FE}",
      ".card{background:#fff;border-radius:18px;border-bottom-left-radius:6px;padding:14px;box-shadow:0 1px 3px rgba(0,19,83,.08);max-width:88%}",
      ".card p{font-size:13px;margin-bottom:10px}.card label{display:block;font-size:11.5px;font-weight:600;color:var(--mute);margin:8px 0 4px}",
      ".card input{width:100%;font:inherit;font-size:13.5px;border:1.5px solid #DADFF3;border-radius:10px;padding:9px 11px;background:#fff;color:var(--ink)}",
      ".card .go{margin-top:12px;width:100%;background:var(--primary);color:#fff;font-weight:700;border-radius:10px;padding:10px;text-align:center}",
      ".card .err{color:#B42318;font-size:11.5px;margin-top:6px}",
      ".card .hold{font-size:12px;color:var(--mute);background:var(--soft);border-radius:10px;padding:8px 10px}",
      ".composer{display:flex;align-items:flex-end;gap:9px;padding:11px 12px;background:#fff;border-top:1px solid var(--line);flex:none}",
      ".composer textarea{flex:1;resize:none;border:0;background:#F2F4FB;border-radius:20px;padding:11px 15px;font:inherit;font-size:13.5px;color:var(--ink);max-height:96px;line-height:1.35}",
      ".composer textarea::placeholder{color:#8B94A8}",
      ".send{width:40px;height:40px;border-radius:50%;background:var(--accent);color:var(--primary);display:flex;align-items:center;justify-content:center;flex:none;transition:opacity .15s}.send[disabled]{opacity:.45;cursor:default}",
      ".sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}",
    ].join("\n");
  }

  // ---------------------------------------------------------------- the widget
  function init(userConfig) {
    if (document.getElementById("zk-chat-host")) return window.ZunkireeChat;
    var cfg = merge(DEFAULT_CONFIG, userConfig || {});
    var transport = cfg.transport || createMockTransport();

    var state = { open: false, view: "home", messages: [], typing: false, quick: [], visitor: null, unread: false, pending: null };
    try {
      var saved = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "null");
      if (saved && Array.isArray(saved.messages)) {
        state.messages = saved.messages;
        state.visitor = saved.visitor || null;
      }
    } catch (e) {
      /* storage can be blocked; the chat still works for this page */
    }
    function save() {
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: state.messages.slice(-80), visitor: state.visitor }));
      } catch (e) {
        /* ignore */
      }
    }

    var host = el("div", { id: "zk-chat-host" });
    var root = host.attachShadow({ mode: "open" });
    root.appendChild(el("style", { text: styles(cfg) }));
    var zk = el("div", { class: "zk" });
    root.appendChild(zk);

    var badge = el("span", { class: "badge", "aria-hidden": "true" });
    var launcher = el(
      "button",
      { class: "launcher", type: "button", "aria-label": "Open chat", "aria-expanded": "false", onclick: toggle },
      [el("span", { class: "ico-chat" }, [svg(ICON.chat, 26, "none", "currentColor")]), el("span", { class: "ico-x" }, [svg(ICON.close, 22)]), badge]
    );
    var panel = el("section", { class: "panel", role: "dialog", "aria-label": "Chat with " + cfg.brand.name, "aria-modal": "false" });
    var live = el("div", { class: "sr", "aria-live": "polite", role: "status" });
    zk.appendChild(panel);
    zk.appendChild(launcher);
    zk.appendChild(live);

    var msgsEl = null;
    var inputEl = null;
    var sendBtn = null;

    // ----- state changes
    function setView(v) {
      state.view = v;
      render();
    }
    function open() {
      state.open = true;
      state.unread = false;
      zk.classList.add("open");
      launcher.setAttribute("aria-expanded", "true");
      launcher.setAttribute("aria-label", "Close chat");
      badge.classList.remove("on");
      render();
      if (state.view === "chat") focusChat();
    }
    function close() {
      state.open = false;
      zk.classList.remove("open");
      launcher.setAttribute("aria-expanded", "false");
      launcher.setAttribute("aria-label", "Open chat");
      launcher.focus({ preventScroll: true });
    }
    function toggle() {
      state.open ? close() : open();
    }

    function pushMessage(m) {
      m.id = uid();
      m.ts = Date.now();
      state.messages.push(m);
      save();
      if (msgsEl) renderMessages();
      if (m.from === "agent") {
        live.textContent = cfg.agent.name + ": " + (m.text || "");
        if (!state.open || state.view !== "chat") {
          state.unread = true;
          badge.classList.add("on");
        }
      }
    }

    var hooks = {
      agentTyping: function (on) {
        state.typing = on;
        if (msgsEl) renderMessages();
      },
      agentMessage: function (reply) {
        state.quick = reply.quick || [];
        pushMessage({ from: "agent", kind: "text", text: reply.text });
        // After the first answer, ask for contact details once, so the team can follow up.
        if (cfg.contact.when === "after" && !state.visitor && !state.messages.some(function (x) { return x.kind === "details"; })) {
          window.setTimeout(function () {
            pushMessage({ from: "agent", kind: "details" });
          }, 700);
        }
      },
    };
    transport.start(state, hooks);

    /** In "before" mode nothing is sent until the visitor has shared how to reach them. */
    function needsDetails() {
      return cfg.contact.when === "before" && !state.visitor;
    }
    function ensureDetailsCard() {
      if (!state.messages.some(function (x) { return x.kind === "details"; })) pushMessage({ from: "agent", kind: "details" });
    }

    /** While the form is open (ask-before mode) the message box waits, so the form stays the focus. */
    function refreshComposer() {
      if (!inputEl) return;
      var waiting = needsDetails();
      inputEl.disabled = waiting;
      inputEl.placeholder = waiting ? "Share your details to start" : cfg.composerPlaceholder;
      if (sendBtn) sendBtn.disabled = waiting || !inputEl.value.trim();
    }
    /** Puts the cursor where the visitor should type next: the form's first field, or the message box. */
    function focusChat() {
      if (needsDetails() && msgsEl) {
        var first = msgsEl.querySelector("input");
        if (first) first.focus();
      } else if (inputEl) {
        inputEl.focus();
      }
    }

    function sendVisitor(text) {
      text = (text || "").trim();
      if (!text) return;
      if (needsDetails()) {
        state.pending = text;
        ensureDetailsCard();
        if (msgsEl) renderMessages();
        return;
      }
      state.quick = [];
      pushMessage({ from: "visitor", kind: "text", text: text });
      transport.send(text);
    }

    // ----- views
    function render() {
      panel.textContent = "";
      msgsEl = inputEl = sendBtn = null;
      if (state.view === "chat") renderChat();
      else if (state.view === "messages") renderMessagesTab();
      else renderHome();
    }

    function teamLine() {
      return el("div", { class: "team" }, [
        el("div", { class: "stack" }, cfg.team.map(function (t) { return el("span", { style: "background:" + t.color, text: t.initials }); })),
        el("small", null, [
          el("b", null, [el("span", { class: "dot" + (cfg.online ? "" : " off") }), cfg.online ? cfg.onlineTitle : cfg.offlineTitle]),
          cfg.online ? cfg.onlineSub : cfg.offlineSub,
        ]),
      ]);
    }

    function footer(active) {
      return [
        el("nav", { class: "nav", "aria-label": "Chat sections" }, [
          el("button", { type: "button", class: active === "home" ? "on" : "", "aria-current": active === "home" ? "page" : null, onclick: function () { setView("home"); } }, [svg(ICON.home, 20), "Home"]),
          el("button", { type: "button", class: active === "messages" ? "on" : "", "aria-current": active === "messages" ? "page" : null, onclick: function () { setView("messages"); } }, [svg(ICON.msgs, 20), "Messages"]),
        ]),
        el("div", { class: "pw", text: "Powered by " + cfg.poweredBy }),
      ];
    }

    function renderHome() {
      var b = cfg.brand;
      panel.appendChild(
        el("div", { class: "hero" }, [
          el("div", { class: "top" }, [
            b.logo ? el("img", { src: b.logo, alt: b.name }) : el("span", { class: "name", text: b.name }),
            el("button", { type: "button", class: "xbtn", "aria-label": "Close chat", onclick: close }, [svg(ICON.close, 14)]),
          ]),
          el("h2", { text: cfg.greeting }),
          teamLine(),
        ])
      );
      var home = el("div", { class: "home" });
      home.appendChild(
        el("button", { type: "button", class: "start", onclick: function () { setView("chat"); focusChat(); } }, [
          el("div", null, [el("b", { text: cfg.startCard.title }), el("span", { class: "sub", text: cfg.startCard.sub })]),
          el("span", { class: "arrow" }, [svg(ICON.arrow, 16)]),
        ])
      );
      if (cfg.topics.length) {
        home.appendChild(el("div", { class: "sec", text: cfg.topicsTitle }));
        home.appendChild(
          el("div", { class: "chips" }, cfg.topics.map(function (t) {
            return el("button", { type: "button", class: "chip", text: t, onclick: function () { setView("chat"); sendVisitor(t); } });
          }))
        );
      }
      if (cfg.link && cfg.link.url) {
        home.appendChild(
          el("a", { class: "linkrow", href: cfg.link.url, target: "_blank", rel: "noopener" }, [
            el("i", null, [svg(ICON.link, 17)]),
            el("div", null, [el("b", { text: cfg.link.label }), el("small", { text: cfg.link.sub || "" })]),
          ])
        );
      }
      panel.appendChild(home);
      footer("home").forEach(function (n) { panel.appendChild(n); });
    }

    function renderMessagesTab() {
      var list = el("div", { class: "list" }, [el("h3", { text: "Messages" })]);
      var last = state.messages.filter(function (m) { return m.kind === "text"; }).slice(-1)[0];
      if (last) {
        list.appendChild(
          el("button", { type: "button", class: "convo", onclick: function () { setView("chat"); } }, [
            el("div", { class: "av" + (cfg.online ? " on" : ""), text: cfg.agent.initials }),
            el("div", { style: "min-width:0" }, [el("b", { text: cfg.agent.name }), el("small", { text: (last.from === "visitor" ? "You: " : "") + last.text })]),
          ])
        );
      } else {
        list.appendChild(
          el("div", { class: "empty" }, [
            el("b", { text: "No messages yet" }),
            "Start a conversation and your messages will show up here.",
            el("div", null, [el("button", { type: "button", class: "btn", text: "Start a conversation", onclick: function () { setView("chat"); } })]),
          ])
        );
      }
      panel.appendChild(list);
      footer("messages").forEach(function (n) { panel.appendChild(n); });
    }

    function renderChat() {
      panel.appendChild(
        el("div", { class: "bar" }, [
          el("button", { type: "button", class: "iconbtn", "aria-label": "Back", onclick: function () { setView("home"); } }, [svg(ICON.back, 20)]),
          el("div", { class: "av" + (cfg.online ? " on" : ""), text: cfg.agent.initials }),
          el("div", { class: "grow" }, [
            el("b", { text: cfg.agent.name }),
            el("small", { text: cfg.online ? "Online · " + cfg.onlineSub.toLowerCase() : cfg.offlineTitle }),
          ]),
          el("button", { type: "button", class: "iconbtn", "aria-label": "Close chat", onclick: close }, [svg(ICON.close, 18)]),
        ])
      );
      msgsEl = el("div", { class: "msgs", role: "log", "aria-label": "Conversation" });
      panel.appendChild(msgsEl);

      inputEl = el("textarea", { rows: "1", placeholder: cfg.composerPlaceholder, "aria-label": "Message", maxlength: "2000" });
      sendBtn = el("button", { type: "button", class: "send", "aria-label": "Send message", disabled: true }, [svg(ICON.arrow, 18)]);
      function sync() {
        sendBtn.disabled = !inputEl.value.trim();
        inputEl.style.height = "auto";
        inputEl.style.height = Math.min(inputEl.scrollHeight, 96) + "px";
      }
      function submit() {
        var v = inputEl.value;
        if (!v.trim()) return;
        inputEl.value = "";
        sync();
        sendVisitor(v);
        inputEl.focus();
      }
      inputEl.addEventListener("input", sync);
      inputEl.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          submit();
        }
      });
      sendBtn.addEventListener("click", submit);
      panel.appendChild(el("div", { class: "composer" }, [inputEl, sendBtn]));
      panel.appendChild(el("div", { class: "pw", text: "Powered by " + cfg.poweredBy }));

      if (!state.messages.length) {
        // A short welcome so the screen is never empty.
        state.messages.push({ id: uid(), ts: Date.now(), from: "agent", kind: "text", text: "Hi! Thanks for reaching out to " + cfg.brand.name + "." + (needsDetails() ? "" : " How can we help?") });
        save();
      }
      if (needsDetails()) ensureDetailsCard();
      renderMessages();
      refreshComposer();
    }

    function renderMessages() {
      if (!msgsEl) return;
      var nearBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 80;
      msgsEl.textContent = "";
      msgsEl.appendChild(el("div", { class: "day", text: "Today" }));
      state.messages.forEach(function (m, i) {
        if (m.kind === "details") return msgsEl.appendChild(detailsCard(m));
        var mine = m.from === "visitor";
        var row = el("div", { class: "row" + (mine ? " v" : "") }, [
          !mine ? el("div", { class: "av", text: cfg.agent.initials.charAt(0) }) : null,
          el("div", { class: "m " + (mine ? "v" : "a"), text: m.text }),
        ]);
        msgsEl.appendChild(row);
        var next = state.messages[i + 1];
        if (!next || next.from !== m.from || next.kind === "details") {
          msgsEl.appendChild(el("div", { class: "meta" + (mine ? " v" : ""), text: (mine ? "" : cfg.agent.name + " · ") + clock(m.ts) }));
        }
      });
      if (state.typing) msgsEl.appendChild(el("div", { class: "typing", "aria-label": cfg.agent.name + " is typing" }, [el("i"), el("i"), el("i")]));
      if (state.quick.length && !state.typing) {
        msgsEl.appendChild(el("div", { class: "qr" }, state.quick.map(function (q) { return el("button", { type: "button", text: q, onclick: function () { sendVisitor(q); } }); })));
      }
      if (nearBottom || state.typing) msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    function detailsCard() {
      var c = cfg.contact;
      if (state.visitor) {
        var who = state.visitor.name ? ", " + state.visitor.name : "";
        return el("div", { class: "row" }, [el("div", { class: "av", text: cfg.agent.initials.charAt(0) }), el("div", { class: "m a", text: "Details shared. Thank you" + who + "." })]);
      }
      var nameIn = c.name.show ? el("input", { type: "text", autocomplete: "name", "aria-label": "Your name", placeholder: "Your full name", maxlength: "120" }) : null;
      var phoneIn = c.phone.show ? el("input", { type: "tel", autocomplete: "tel", "aria-label": "WhatsApp number", placeholder: "WhatsApp number", maxlength: "30" }) : null;
      var emailIn = c.email.show ? el("input", { type: "email", autocomplete: "email", "aria-label": "Email", placeholder: "you@example.com", maxlength: "200" }) : null;
      var err = el("div", { class: "err", role: "alert" });
      function field(label, input, required) {
        return input ? [el("label", { text: label + (required ? "" : " (optional)") }), input] : [];
      }
      var intro = c.when === "before" ? c.introBefore : c.introAfter;
      var kids = [el("p", { text: intro })];
      if (state.pending) kids.push(el("p", { class: "hold", text: c.holdNote }));
      kids = kids
        .concat(field("Your name", nameIn, c.name.required))
        .concat(field("WhatsApp number", phoneIn, c.phone.required))
        .concat(field("Email", emailIn, c.email.required))
        .concat([err, el("button", { type: "submit", class: "go", text: c.submit })]);

      var form = el("form", {
        novalidate: true,
        onsubmit: function (e) {
          e.preventDefault();
          var n = nameIn ? nameIn.value.trim() : "";
          var p = phoneIn ? phoneIn.value.trim() : "";
          var em = emailIn ? emailIn.value.trim() : "";
          var digits = p.replace(/\D/g, "");
          var problems = [];
          if (nameIn && c.name.required && !n) problems.push("your name");
          if (phoneIn && (c.phone.required || p) && digits.length < 7) problems.push("a valid WhatsApp number");
          if (emailIn && ((c.email.required && !em) || (em && !EMAIL_PATTERN.test(em)))) problems.push(em ? "a valid email" : "your email");
          if (problems.length) {
            err.textContent = "Please add " + problems.join(" and ") + ".";
            return;
          }
          if ((phoneIn || emailIn) && digits.length < 7 && !em) {
            var how = phoneIn && emailIn ? "a WhatsApp number or an email" : phoneIn ? "a WhatsApp number" : "an email";
            err.textContent = "Please add " + how + " so we can reach you.";
            return;
          }
          state.visitor = { name: n, phone: p, email: em };
          var held = state.pending;
          state.pending = null;
          save();
          renderMessages();
          refreshComposer();
          if (held) sendVisitor(held);
          else transport.submitDetails(state.visitor);
          if (inputEl) inputEl.focus();
        },
      }, kids);
      return el("div", { class: "row" }, [el("div", { class: "av", text: cfg.agent.initials.charAt(0) }), el("div", { class: "card" }, [form])]);
    }

    zk.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.open) close();
    });

    document.body.appendChild(host);
    render();
    return window.ZunkireeChat;
  }

  /** Hides or shows the whole widget (for example on pages where chat must not appear). Safe before init. */
  function setHidden(hidden) {
    var host = document.getElementById("zk-chat-host");
    if (host) host.style.display = hidden ? "none" : "";
  }

  window.ZunkireeChat = { init: init, setHidden: setHidden, version: "0.1.0-prototype" };
})();
