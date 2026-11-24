(function () {
  "use strict";

  const AO = (window.AgentOffice = window.AgentOffice || {});

  AO.STAGE = { w: 1000, h: 620 };

  AO.ROLES = {
    manager: { label: "产品经理", short: "PM", color: "#f2b544" },
    research: { label: "研究员", short: "RES", color: "#b58cff" },
    design: { label: "设计师", short: "DSN", color: "#ff7fa8" },
    engineer: { label: "工程师", short: "ENG", color: "#55d6c2" },
    qa: { label: "测试", short: "QA", color: "#ff6b6b" },
    assistant: { label: "行政助理", short: "EA", color: "#c9a0dc" }
  };

  // x/y 是角色的“脚底”位置；桌子画在角色背后。
  AO.DESKS = [
    { id: "d1", x: 160, y: 210, boss: true },
    { id: "d2", x: 350, y: 330 },
    { id: "d3", x: 520, y: 330 },
    { id: "d4", x: 150, y: 480 },
    { id: "d5", x: 320, y: 480 },
    { id: "d6", x: 490, y: 480 },
    { id: "d7", x: 435, y: 230, w: 70, hot: true },
    { id: "d8", x: 580, y: 545, w: 70, hot: true }
  ];

  AO.BOSS_OFFICE = {
    rect: { x: 40, y: 64, w: 250, h: 230 },
    door: { x: 196, y: 284, w: 64, h: 14 },
    rug: { x: 60, y: 110, w: 210, h: 168 },
    window: { x: 54, y: 68, w: 218, h: 32 },
    desk: { x: 108, y: 136, w: 104, h: 46 },
    seat: { x: 160, y: 210 },
    shelf: { x: 48, y: 98, w: 20, h: 62 },
    sofa: { x: 226, y: 136, w: 52, h: 28 },
    armchair: { x: 250, y: 196, w: 24, h: 24 },
    coffeeTable: { x: 210, y: 172, w: 34, h: 20 },
    guestRug: { x: 208, y: 128, w: 72, h: 104 },
    bar: { x: 52, y: 246, w: 76, h: 36 },
    trophyWall: { x: 226, y: 104, w: 52, h: 28 },
    plant: { x: 92, y: 180 },
    lamp: { x: 58, y: 164 }
  };

  AO.AGENTS = [
    {
      id: "a1", name: "林澈", role: "manager", deskId: "d1",
      skin: "#e8b08a", hair: "#2b1d16", shirt: "#f2b544",
      hairStyle: "short", accessory: "tie",
      trait: "冷静，负责兜底。嘴上说“最后一版”，心里知道还有三版。"
    },
    {
      id: "a2", name: "苏晚", role: "design", deskId: "d2",
      skin: "#f0c3a0", hair: "#5a2a3a", shirt: "#ff7fa8",
      hairStyle: "bob", accessory: "scarf",
      trait: "细节控，审美暴君。能为一像素的间距开一次会。"
    },
    {
      id: "a3", name: "陈默", role: "engineer", deskId: "d3",
      skin: "#d9a075", hair: "#1c2b33", shirt: "#55d6c2",
      hairStyle: "messy", accessory: "headphones",
      trait: "话少，手速快。耳机一戴，谁都不爱。"
    },
    {
      id: "a4", name: "周野", role: "engineer", deskId: "d4",
      skin: "#c98d63", hair: "#3a2a1a", shirt: "#7bd88f",
      hairStyle: "curly", accessory: "none",
      trait: "乐观，爱造轮子。口头禅：这个我自己写一个。"
    },
    {
      id: "a5", name: "顾遥", role: "research", deskId: "d5",
      skin: "#f2c6a8", hair: "#2a1f3a", shirt: "#b58cff",
      hairStyle: "long", accessory: "glasses",
      trait: "严谨，喜欢追问为什么。简历上写着“擅长把问题问大”。"
    },
    {
      id: "a6", name: "唐可", role: "qa", deskId: "d6",
      skin: "#e6ac86", hair: "#3a1f1f", shirt: "#ff6b6b",
      hairStyle: "ponytail", accessory: "cap",
      trait: "毒舌，bug Hunter。最喜欢说：这个场景你测过吗？"
    }
  ];

  AO.SECRETARY = {
    name: "小满",
    role: "assistant",
    x: 170,
    y: 350,
    skin: "#f0c3a0",
    hair: "#2a1f2a",
    shirt: "#c9a0dc",
    hairStyle: "bob",
    accessory: "headphones"
  };

  AO.MEETING = {
    room: { x: 650, y: 118, w: 300, h: 232 },
    door: { x: 700, y: 340, w: 60, h: 14 },
    rug: { x: 662, y: 130, w: 276, h: 208 },
    table: { x: 725, y: 205, w: 150, h: 70 },
    screen: { x: 738, y: 132, w: 124, h: 30 },
    seats: [
      { x: 735, y: 188 },
      { x: 800, y: 176 },
      { x: 865, y: 188 },
      { x: 735, y: 308 },
      { x: 800, y: 318 },
      { x: 865, y: 308 }
    ]
  };

  AO.LAYOUT = {
    whiteboard: { x: 340, y: 58, w: 250, h: 82 },
    whiteboardSpot: { x: 465, y: 178 },
    openOffice: {
      rugTop: { x: 300, y: 250, w: 290, h: 155 },
      rugBottom: { x: 90, y: 405, w: 500, h: 175 },
      aisleRug: { x: 590, y: 150, w: 60, h: 430 }
    },
    lounge: { x: 650, y: 430, w: 300, h: 150 },
    couch: { x: 690, y: 480, w: 150, h: 40 },
    coffee: { x: 900, y: 435, w: 36, h: 58 },
    sideTable: { x: 800, y: 520, w: 50, h: 28 },
    beanbag: { x: 850, y: 548, w: 30, h: 22 },
    cat: { x: 768, y: 484 },
    leftFurniture: {
      serverRack: { x: 44, y: 306, w: 36, h: 46 },
      shelf: { x: 48, y: 360, w: 40, h: 100 },
      printer: { x: 44, y: 470, w: 40, h: 30 }
    },
    reception: {
      rug: { x: 126, y: 304, w: 80, h: 88 },
      desk: { x: 142, y: 362, w: 56, h: 24 },
      chair: { x: 157, y: 348, w: 26, h: 12 }
    },
    plants: [
      { x: 92, y: 180 },
      { x: 60, y: 555 },
      { x: 930, y: 550 },
      { x: 925, y: 330 },
      { x: 930, y: 400 },
      { x: 570, y: 235, big: true },
      { x: 310, y: 200 }
    ],
    anchors: {
      coffee: { x: 890, y: 512 },
      couch: { x: 745, y: 548 },
      chat: { x: 610, y: 515 },
      window: { x: 600, y: 180 },
      door: { x: 950, y: 360 },
      wander: [
        { x: 600, y: 170 },
        { x: 600, y: 320 },
        { x: 600, y: 470 },
        { x: 620, y: 545 },
        { x: 560, y: 225 },
        { x: 680, y: 558 },
        { x: 310, y: 400 },
        { x: 410, y: 540 },
        { x: 480, y: 200 }
      ]
    }
  };

  AO.HUBS = [
    { x: 230, y: 255 },
    { x: 230, y: 325 },
    { x: 600, y: 160 },
    { x: 600, y: 300 },
    { x: 600, y: 430 },
    { x: 600, y: 545 },
    { x: 300, y: 390 },
    { x: 455, y: 350 },
    { x: 455, y: 230 },
    { x: 300, y: 230 },
    { x: 235, y: 470 },
    { x: 600, y: 230 },
    { x: 730, y: 370 },
    { x: 730, y: 330 },
    { x: 690, y: 300 },
    { x: 690, y: 180 },
    { x: 900, y: 300 },
    { x: 650, y: 400 },
    { x: 650, y: 520 },
    { x: 860, y: 505 },
    { x: 405, y: 470 },
    { x: 630, y: 430 },
    { x: 630, y: 545 },
    { x: 860, y: 430 },
    { x: 860, y: 545 }
  ];

  AO.OBSTACLES = [
    // 老板办公室玻璃墙
    { x: 40, y: 64, w: 250, h: 8 },
    { x: 40, y: 64, w: 8, h: 230 },
    { x: 282, y: 64, w: 8, h: 230 },
    { x: 40, y: 286, w: 156, h: 8 },
    { x: 260, y: 286, w: 30, h: 8 },
    // 老板办公桌、书架、酒柜
    { x: 108, y: 136, w: 104, h: 46 },
    { x: 48, y: 98, w: 20, h: 62 },
    { x: 52, y: 246, w: 76, h: 36 },
    // 秘书台
    { x: 142, y: 362, w: 56, h: 24 },
    // 会议室玻璃墙
    { x: 650, y: 118, w: 300, h: 8 },
    { x: 650, y: 118, w: 8, h: 232 },
    { x: 942, y: 118, w: 8, h: 232 },
    { x: 650, y: 342, w: 50, h: 8 },
    { x: 760, y: 342, w: 190, h: 8 },
    // 会议桌
    { x: 725, y: 205, w: 150, h: 70 },
    // 休息区
    { x: 690, y: 480, w: 150, h: 40 },
    { x: 900, y: 435, w: 36, h: 58 },
    { x: 800, y: 520, w: 50, h: 28 },
    { x: 850, y: 548, w: 30, h: 22 },
    // 左侧家具
    { x: 44, y: 306, w: 36, h: 46 },
    { x: 48, y: 360, w: 40, h: 100 },
    { x: 44, y: 470, w: 40, h: 30 },
    // 工位之间的绿植隔断
    { x: 205, y: 394, w: 50, h: 12 },
    { x: 385, y: 394, w: 50, h: 12 }
  ].concat(
    AO.DESKS.filter(function (d) {
      return !d.boss;
    }).map(function (d) {
      return { x: d.x - (d.w || 90) / 2, y: d.y - 70, w: d.w || 90, h: d.h || 42 };
    })
  );

  AO.LINES = {
    claim: [
      "我来接「{task}」，先拆一下。",
      "「{task}」交给我。",
      "这个我熟，「{task}」开始。",
      "行，「{task}」我认领了。"
    ],
    resume: [
      "回来继续「{task}」。",
      "「{task}」还差一点，收个尾。",
      "回到工位，接着干。"
    ],
    work: [
      "正在处理「{task}」…",
      "这块比想象中麻烦。",
      "进度 {p}%，稳住。",
      "别催，在写了在写了。",
      "再给我一点时间。"
    ],
    milestone: [
      "「{task}」过半，方向没问题。",
      "{p}% 了，可以准备下游。",
      "核心部分跑通了。"
    ],
    reviewAsk: [
      "「{task}」做完了，{to} 帮忙看一眼。",
      "{to}，「{task}」提审了。",
      "「{task}」先放评审，我去接下一个。"
    ],
    reviewStart: [
      "我看看…",
      "先跑一遍，再看代码。",
      "这个交互有点意思。"
    ],
    approve: [
      "「{task}」通过，质量不错。",
      "没问题，合并。",
      "可以，下一环可以动了。"
    ],
    reject: [
      "「{task}」有个小问题，退回改一下。",
      "边界情况没覆盖，再补一版。",
      "这版不行，但方向对，改完再提。"
    ],
    coffee: [
      "脑子冒烟了，去续一杯。",
      "摸鱼 3 分钟，马上回来。",
      "咖啡机，我来了。",
      "站起来走走，顺便想想。"
    ],
    coffeeDone: [
      "满血复活。",
      "这杯有点浓，继续。",
      "回来了，刚才想到一个点子。"
    ],
    meetingCall: [
      "拉个短会，把依赖捋清楚。",
      "会议室对齐一下，别各做各的。",
      "十分钟，把风险过一遍。"
    ],
    meetingJoin: [
      "来了来了。",
      "我先说结论。",
      "这会不开不行了。",
      "带上电脑，边开边改。"
    ],
    meetingLine: [
      "我这边卡在接口字段。",
      "设计稿还差一个空状态。",
      "先把主流程跑通，细节后补。",
      "这个需求今天必须收口。",
      "我同意，但排期要挪。",
      "谁负责同步给老板？"
    ],
    meetingEnd: [
      "行，就这么定。",
      "会后我拉个清单。",
      "散会，回去干活。"
    ],
    blocked: [
      "卡住了：{reason}。",
      "这里缺个决策，先挂起。",
      "等一个输入，不然没法往下做。"
    ],
    chat: [
      "你那边顺利吗？",
      "这个方案你觉得行吗？",
      "中午吃什么？",
      "别卷了，喝口水。",
      "我刚看到一个挺有意思的做法。"
    ],
    done: [
      "「{task}」完成。",
      "收工，下一个。",
      "这个可以交付了。"
    ],
    celebrate: [
      "上线了！",
      "可以发朋友圈了。",
      "今晚我请奶茶。",
      "别急着庆祝，先看监控。",
      "终于不用再改了吧？"
    ],
    idle: [
      "等下游。",
      "看看还有没有活。",
      "先整理一下思路。"
    ]
  };


  // =========================================================
  // Work ledger: skills, artifacts, checks
  // =========================================================

  AO.SKILL_CATALOG = {
    planning: { name: "冲刺规划", category: "PLAN" },
    "risk-review": { name: "风险复盘", category: "RISK" },
    "release-gate": { name: "发布门禁", category: "GATE" },
    "stakeholder-sync": { name: "干系人同步", category: "COMMS" },
    "competitive-analysis": { name: "竞品分析", category: "RESEARCH" },
    "user-interviews": { name: "用户访谈", category: "RESEARCH" },
    synthesis: { name: "洞察综合", category: "RESEARCH" },
    "citation-check": { name: "证据核验", category: "RESEARCH" },
    "information-architecture": { name: "信息架构", category: "DESIGN" },
    wireframing: { name: "线框设计", category: "DESIGN" },
    "visual-design": { name: "视觉设计", category: "DESIGN" },
    "design-system": { name: "设计系统", category: "DESIGN" },
    accessibility: { name: "无障碍", category: "DESIGN" },
    react: { name: "React 实现", category: "ENG" },
    "api-design": { name: "接口设计", category: "ENG" },
    testing: { name: "自动化测试", category: "ENG" },
    performance: { name: "性能优化", category: "ENG" },
    security: { name: "安全检查", category: "ENG" },
    a11y: { name: "可访问性实现", category: "ENG" },
    debugging: { name: "故障定位", category: "ENG" },
    "test-plan": { name: "测试计划", category: "QA" },
    e2e: { name: "端到端测试", category: "QA" },
    regression: { name: "回归测试", category: "QA" },
    "bug-report": { name: "缺陷报告", category: "QA" },
    "a11y-verification": { name: "无障碍验证", category: "QA" }
  };

  AO.ROLE_SKILLS = {
    manager: ["planning", "risk-review", "release-gate", "stakeholder-sync"],
    research: ["competitive-analysis", "user-interviews", "synthesis", "citation-check"],
    design: ["information-architecture", "wireframing", "visual-design", "design-system", "accessibility"],
    engineer: ["react", "api-design", "testing", "performance", "security", "a11y", "debugging"],
    qa: ["test-plan", "e2e", "regression", "bug-report", "a11y-verification"],
    assistant: []
  };

  AO.CHECK_TEMPLATES = {
    research: [
      { id: "sources", label: "来源与引用可追溯", severity: "high" },
      { id: "bias-check", label: "样本偏差检查", severity: "medium" },
      { id: "actionability", label: "结论可执行", severity: "high" },
      { id: "data-quality", label: "原始数据归档", severity: "medium" }
    ],
    design: [
      { id: "accessibility", label: "无障碍与对比度", severity: "high" },
      { id: "responsive-spec", label: "响应式标注", severity: "medium" },
      { id: "design-review", label: "设计评审记录", severity: "high" },
      { id: "component-coverage", label: "组件/状态覆盖", severity: "medium" }
    ],
    engineer: [
      { id: "tests", label: "自动化测试", severity: "high" },
      { id: "a11y", label: "无障碍检查", severity: "high" },
      { id: "performance", label: "性能预算", severity: "medium" },
      { id: "error-states", label: "错误/空状态", severity: "high" },
      { id: "security", label: "安全检查", severity: "high" }
    ],
    qa: [
      { id: "coverage", label: "测试覆盖率", severity: "high" },
      { id: "regression", label: "回归范围", severity: "high" },
      { id: "bug-triage", label: "缺陷分级", severity: "medium" },
      { id: "a11y-verification", label: "无障碍验证", severity: "high" }
    ],
    manager: [
      { id: "rollback", label: "回滚方案", severity: "high" },
      { id: "monitoring", label: "监控与告警", severity: "high" },
      { id: "comms", label: "对外沟通", severity: "medium" },
      { id: "ownership", label: "责任人与升级路径", severity: "medium" }
    ]
  };

  AO.CHECK_ACTIONS = {
    sources: "补来源链接与引用，确保结论可追溯",
    "bias-check": "做样本偏差检查，标注样本局限",
    actionability: "把洞察转成明确的下一步动作",
    "data-quality": "归档原始数据与访谈记录",
    tests: "补自动化测试并接入 CI 门禁",
    a11y: "跑键盘走查与 axe，修复无障碍问题",
    performance: "补性能预算并实测 LCP / INP",
    "error-states": "补空态、错误态与加载失败回退",
    security: "做安全检查与依赖审计",
    accessibility: "补对比度、键盘与读屏检查",
    "responsive-spec": "补响应式断点与组件标注",
    "design-review": "补设计评审结论与决策记录",
    "component-coverage": "补缺失的组件状态与边界稿",
    coverage: "补覆盖率报告与未覆盖路径说明",
    regression: "扩大回归范围，覆盖受影响链路",
    "bug-triage": "对缺陷分级并指定修复负责人",
    "a11y-verification": "补无障碍专项验证与录屏证据",
    rollback: "补回滚方案并做一次演练",
    monitoring: "补监控、告警与值班看板",
    comms: "补对外沟通模板与状态页更新",
    ownership: "明确责任人与升级路径"
  };

  AO.WORK = {
    "launch:t1": [
      { skill: "competitive-analysis", tool: "web_search", action: "抓取 5 个竞品官网与定价页", file: "research/competitive.md", line: [1, 46], add: 42, del: 0, checks: ["sources"], note: "截图与来源链接已归档" },
      { skill: "user-interviews", tool: "notes", action: "整理 6 条用户访谈与原始记录", file: "research/interviews.md", line: [12, 88], add: 54, del: 3, checks: ["data-quality"], note: "匿名化后归档" },
      { skill: "synthesis", tool: "docs", action: "输出 3 个机会点与优先级", file: "research/insights.md", line: [1, 32], add: 28, del: 0, checks: ["actionability"], note: "每条洞察附建议动作" }
    ],
    "launch:t2": [
      { skill: "information-architecture", tool: "figma", action: "画信息架构与 4 张线框", file: "design/ia-wireframes.fig", frames: 4, checks: ["component-coverage"], note: "覆盖首页 / 定价 / FAQ / 登录" },
      { skill: "wireframing", tool: "docs", action: "补交互说明与断点规则", file: "design/ia-spec.md", line: [1, 38], add: 36, del: 0, checks: ["design-review"], note: "评审结论在评论区" }
    ],
    "launch:t3": [
      { skill: "visual-design", tool: "figma", action: "定视觉方向与 6 个关键页面", file: "design/visual-direction.fig", frames: 6, checks: ["component-coverage"] },
      { skill: "design-system", tool: "edit", action: "建立颜色 / 字号 / 间距 tokens", file: "design/tokens.json", line: [1, 64], add: 64, del: 0, checks: ["design-review"] },
      { skill: "information-architecture", tool: "docs", action: "补响应式断点与组件状态说明", file: "design/responsive-notes.md", line: [1, 28], add: 26, del: 0, checks: ["responsive-spec"] }
    ],
    "launch:t4": [
      {
        skill: "react", tool: "edit", action: "实现首屏 Hero、导航与 CTA，补空状态",
        file: "src/pages/Home.tsx", line: [24, 118], add: 86, del: 12, checks: ["error-states"],
        diff: [
          '- <section className="hero">',
          '+ <section className="hero" aria-labelledby="hero-title">',
          '+   <h1 id="hero-title">{copy.headline}</h1>',
          '+   {!copy.cta && <span className="hero-fallback">查看定价</span>}'
        ],
        note: "抽出 Hero 组件，补了 CTA 兜底"
      },
      {
        skill: "react", tool: "edit", action: "接文案数据并处理加载/错误态",
        file: "src/components/Hero.tsx", line: [1, 142], add: 120, del: 20, checks: ["performance"],
        diff: [
          '- export function Hero() {',
          '+ export function Hero({ copy }: HeroProps) {',
          '+   const [ready, setReady] = useState(false);',
          '+   return <section className="hero" data-ready={ready}>'
        ]
      },
      { skill: "performance", tool: "edit", action: "压缩首屏图片与字体，LCP 预算 2.5s", file: "src/styles/hero.css", line: [10, 96], add: 72, del: 4, checks: [] }
    ],
    "launch:t5": [
      {
        skill: "react", tool: "edit", action: "实现定价卡、对比表与 FAQ 折叠",
        file: "src/pages/Pricing.tsx", line: [18, 96], add: 64, del: 8, checks: ["error-states"],
        diff: [
          '- <PricingCard plan={plan} />',
          '+ <PricingCard plan={plan} highlighted={plan.id === "pro"} />',
          '+ {plans.length === 0 && <EmptyPricing />}'
        ]
      },
      { skill: "api-design", tool: "edit", action: "把 FAQ 抽成结构化数据并补搜索", file: "src/data/faq.ts", line: [1, 48], add: 42, del: 0, checks: ["performance"] }
    ],
    "launch:t6": [
      {
        skill: "react", tool: "edit", action: "补移动导航、断点与滚动动效",
        file: "src/styles/responsive.css", line: [8, 124], add: 96, del: 10, checks: ["performance", "a11y"],
        diff: [
          '+ @media (max-width: 720px) {',
          '+   .nav-desktop { display: none; }',
          '+   .nav-mobile { display: flex; }'
        ]
      },
      { skill: "react", tool: "edit", action: "修移动端菜单与键盘焦点陷阱", file: "src/components/MobileNav.tsx", line: [1, 72], add: 60, del: 4, checks: ["error-states"] }
    ],
    "launch:t7": [
      {
        skill: "test-plan", tool: "edit", action: "写主流程与边界 E2E 用例",
        file: "tests/e2e/launch.spec.ts", line: [1, 140], add: 132, del: 0, checks: ["coverage", "regression"],
        diff: [
          '+ test("hero CTA opens signup", async ({ page }) => {',
          '+   await page.goto("/");',
          '+   await page.getByRole("link", { name: "开始使用" }).click();',
          '+   await expect(page).toHaveURL(/signup/);'
        ]
      },
      { skill: "bug-report", tool: "docs", action: "整理缺陷分级与复现步骤", file: "reports/qa-report.md", line: [1, 46], add: 44, del: 0, checks: ["bug-triage"] }
    ],
    "launch:t8": [
      { skill: "release-gate", tool: "docs", action: "发布检查单：监控、告警、公告", file: "ops/release-checklist.md", line: [1, 52], add: 50, del: 0, checks: ["monitoring", "comms"] },
      { skill: "risk-review", tool: "docs", action: "值班人与升级路径", file: "ops/oncall.md", line: [1, 30], add: 28, del: 0, checks: ["ownership"] }
    ],
    "launch:t9": [
      {
        skill: "a11y", tool: "edit", action: "接暗色主题 tokens 与系统偏好",
        file: "src/styles/dark.css", line: [6, 88], add: 74, del: 2, checks: ["a11y", "performance"],
        diff: [
          '+ :root[data-theme="dark"] {',
          '+   --bg: #0b1017;',
          '+   --text: #e8f0f8;',
          '+ }'
        ]
      },
      { skill: "react", tool: "edit", action: "补对比度与切换持久化", file: "src/theme/tokens.ts", line: [1, 56], add: 48, del: 0, checks: [] }
    ],
    "incident:t1": [
      { skill: "risk-review", tool: "docs", action: "事故分级、影响面与对外口径", file: "ops/incident-2026-11-24.md", line: [1, 34], add: 32, del: 0, checks: ["monitoring", "comms"] }
    ],
    "incident:t2": [
      { skill: "debugging", tool: "bash", action: "拉取支付错误日志与调用链", file: "scripts/pull-logs.sh", line: [1, 26], add: 24, del: 0, checks: ["error-states"] },
      { skill: "performance", tool: "bash", action: "按时间窗聚合支付失败率", file: "logs/payment-2026-11-24.log", line: [1, 400], add: 0, del: 0, checks: ["performance"], note: "读取 400 行日志" }
    ],
    "incident:t3": [
      {
        skill: "debugging", tool: "edit", action: "定位回调签名版本错配",
        file: "src/payments/signature.ts", line: [88, 96], add: 6, del: 2, checks: ["error-states", "security"],
        diff: [
          '- if (payload.version !== "v1") throw new Error("bad signature");',
          '+ const version = payload.version ?? "v1";',
          '+ if (!SIGNATURE_VERSIONS.includes(version)) {',
          '+   throw new SignatureError(version);',
          '+ }'
        ]
      },
      { skill: "debugging", tool: "docs", action: "写 RCA 草稿与时间线", file: "docs/rca-draft.md", line: [1, 40], add: 38, del: 0, checks: ["performance"] }
    ],
    "incident:t4": [
      {
        skill: "security", tool: "edit", action: "灰度回滚支付服务",
        file: "k8s/payments.yaml", line: [42, 70], add: 8, del: 6, checks: ["security", "error-states"],
        diff: [
          '- replicas: 6',
          '+ replicas: 2',
          '+ image: payments:2026.11.23-hotfix'
        ]
      },
      { skill: "debugging", tool: "docs", action: "回滚记录与观察指标", file: "ops/rollback-payments.md", line: [1, 36], add: 34, del: 0, checks: ["performance"] }
    ],
    "incident:t5": [
      { skill: "visual-design", tool: "docs", action: "状态页与客服话术", file: "comms/status-page.md", line: [1, 28], add: 26, del: 0, checks: ["design-review"] },
      { skill: "design-system", tool: "docs", action: "统一公告模板与语气", file: "comms/support-script.md", line: [1, 40], add: 38, del: 0, checks: ["component-coverage"] }
    ],
    "incident:t6": [
      {
        skill: "e2e", tool: "edit", action: "支付 / 退款 / 对账全链路回归",
        file: "tests/e2e/payments.spec.ts", line: [1, 180], add: 168, del: 0, checks: ["coverage", "regression"],
        diff: [
          '+ test("payment succeeds after rollback", async ({ request }) => {',
          '+   const res = await request.post("/api/pay", { data: payload });',
          '+   expect(res.status()).toBe(200);'
        ]
      },
      { skill: "bug-report", tool: "docs", action: "回归结果与遗留缺陷", file: "reports/regression.md", line: [1, 30], add: 28, del: 0, checks: ["bug-triage"] }
    ],
    "incident:t7": [
      { skill: "synthesis", tool: "docs", action: "事故时间线与根因复盘", file: "docs/rca.md", line: [1, 72], add: 70, del: 0, checks: ["sources", "actionability"] },
      { skill: "citation-check", tool: "docs", action: "支付链路证据与指标归档", file: "research/payment-timeline.md", line: [1, 30], add: 28, del: 0, checks: ["data-quality"] }
    ],
    "incident:t8": [
      { skill: "risk-review", tool: "docs", action: "复盘会结论与改进项", file: "ops/incident-review.md", line: [1, 44], add: 42, del: 0, checks: ["monitoring", "comms", "ownership"] }
    ]
  };

  AO.FALLBACK_WORK = {
    manager: [
      { skill: "planning", tool: "docs", action: "拆解临时任务并同步看板", file: "ops/adhoc-plan.md", line: [1, 24], add: 22, del: 0, checks: ["ownership"] }
    ],
    research: [
      { skill: "synthesis", tool: "docs", action: "快速调研并给出结论", file: "research/adhoc-brief.md", line: [1, 26], add: 24, del: 0, checks: ["sources", "actionability"] }
    ],
    design: [
      { skill: "visual-design", tool: "figma", action: "补临时视觉与组件状态", file: "design/adhoc.fig", frames: 2, checks: ["component-coverage"] }
    ],
    engineer: [
      { skill: "react", tool: "edit", action: "实现临时需求与错误态", file: "src/pages/Adhoc.tsx", line: [1, 64], add: 56, del: 0, checks: ["error-states"] }
    ],
    qa: [
      { skill: "a11y-verification", tool: "playwright", action: "执行无障碍与主流程检查", file: "tests/e2e/adhoc.spec.ts", line: [1, 48], add: 46, del: 0, checks: ["a11y-verification", "coverage"] }
    ]
  };

  AO.SCENARIOS = {
    launch: {
      id: "launch",
      name: "产品发布冲刺",
      officeName: "SPRINT OFFICE",
      neon: "SHIP IT",
      goal: "发布 AI 产品官网",
      brief: "从调研到上线，6 个 agent 自己拆活、自己协作、自己收尾。",
      finishText: "官网已发布，监控正常。",
      finishBubble: "上线了！",
      tasks: [
        { id: "t1", title: "竞品与用户调研", role: "research", effort: 5, priority: 3, deps: [], desc: "梳理 5 个竞品，输出可执行洞察" },
        { id: "t2", title: "信息架构与线框", role: "design", effort: 6, priority: 3, deps: ["t1"], desc: "把洞察变成页面结构" },
        { id: "t3", title: "视觉方向与高保真稿", role: "design", effort: 7, priority: 3, deps: ["t2"], desc: "定调性、组件与关键页面" },
        { id: "t4", title: "首页 Hero 与导航", role: "engineer", effort: 7, priority: 3, deps: ["t3"], desc: "首屏、导航、CTA" },
        { id: "t5", title: "定价页与 FAQ", role: "engineer", effort: 6, priority: 2, deps: ["t3"], desc: "套餐、对比、常见问题" },
        { id: "t6", title: "响应式与动效打磨", role: "engineer", effort: 5, priority: 2, deps: ["t4", "t5"], desc: "移动端、滚动动效、性能" },
        { id: "t7", title: "端到端测试与验收", role: "qa", effort: 5, priority: 3, deps: ["t6"], desc: "主流程、边界、回归" },
        { id: "t8", title: "部署与发布检查", role: "manager", effort: 4, priority: 3, deps: ["t7"], desc: "监控、回滚、公告" }
      ],
      events: [
        { at: 2, kind: "say", agent: "a1", text: "早。今天的目标只有一个：把 AI 产品官网上线。看板已经拆好了，各就各位。" },
        { at: 5, kind: "say", agent: "a1", text: "顾遥先出调研，苏晚等结论再动线框。工程侧先看技术方案，不要抢跑。" },
        { at: 8, when: "t1done", kind: "meeting", title: "设计对齐会", agenda: "信息架构、视觉方向、工程可行性", participants: ["a1", "a2", "a3", "a4", "a5"] },
        { at: 16, when: "engineerActive", kind: "blocker", role: "engineer", text: "工程侧卡住了：接口字段和设计稿对不上，需要一次当场对齐。" },
        { at: 20, when: "t3done", kind: "newTask", task: { id: "t9", title: "暗色模式适配", role: "engineer", effort: 4, priority: 2, deps: ["t3"], desc: "CEO 临时加的" }, text: "CEO 在群里说：竞品都有暗色模式，我们也加上。" },
        { at: 30, when: "t6done", kind: "meeting", title: "发布前风险会", agenda: "回归结果、回滚方案、发布窗口", participants: ["a1", "a3", "a4", "a6"] },
        { at: 40, when: "t7done", kind: "say", agent: "a6", text: "最后一遍回归过了，谁都不许再改文案。" }
      ]
    },
    incident: {
      id: "incident",
      name: "支付事故响应",
      officeName: "INCIDENT ROOM",
      neon: "ALL HANDS",
      goal: "支付故障：30 分钟内恢复",
      brief: "线上支付回调失败。先止血，再定位，最后复盘。",
      finishText: "支付已恢复，事故报告已归档。",
      finishBubble: "恢复了！",
      tasks: [
        { id: "t1", title: "事故分级与影响面", role: "manager", effort: 3, priority: 5, deps: [], desc: "确认 P 级、受影响用户与金额" },
        { id: "t2", title: "拉取错误日志与链路", role: "engineer", effort: 4, priority: 5, deps: ["t1"], desc: "定位失败集中点" },
        { id: "t3", title: "定位回调签名失败", role: "engineer", effort: 5, priority: 5, deps: ["t2"], desc: "找到根因并给出修复方案" },
        { id: "t4", title: "灰度回滚支付服务", role: "engineer", effort: 4, priority: 5, deps: ["t3"], desc: "先止血，再观察" },
        { id: "t5", title: "用户公告与客服话术", role: "design", effort: 3, priority: 4, deps: ["t1"], desc: "对外沟通，降低恐慌" },
        { id: "t6", title: "全链路回归", role: "qa", effort: 4, priority: 5, deps: ["t4"], desc: "支付、退款、对账" },
        { id: "t7", title: "根因复盘文档", role: "research", effort: 4, priority: 3, deps: ["t3"], desc: "时间线、根因、改进项" },
        { id: "t8", title: "事故复盘会", role: "manager", effort: 2, priority: 4, deps: ["t6", "t7"], desc: "对齐改进项与负责人" }
      ],
      events: [
        { at: 1, kind: "say", agent: "a1", text: "支付成功率掉了 18%，先按 P1 处理。所有人看板上的优先级重排，止血第一。" },
        { at: 5, when: "t1done", kind: "meeting", title: "止血对齐会", agenda: "影响面、回滚窗口、对外口径", participants: ["a1", "a3", "a4", "a6"] },
        { at: 10, when: "engineerActive", kind: "blocker", role: "engineer", text: "回滚包依赖冲突，需要当场确认版本。" },
        { at: 14, when: "t3done", kind: "newTask", task: { id: "t9", title: "补充支付监控告警", role: "engineer", effort: 3, priority: 3, deps: [], desc: "不能在同一个坑里摔两次" }, text: "SRE 建议：顺手把支付成功率告警补上。" },
        { at: 24, when: "t6done", kind: "meeting", title: "复盘准备会", agenda: "时间线、根因、改进项", participants: ["a1", "a4", "a5", "a6"] }
      ]
    }
  };

  AO.START_POSITIONS = [
    { x: 160, y: 252 },
    { x: 350, y: 395 },
    { x: 520, y: 395 },
    { x: 150, y: 545 },
    { x: 320, y: 545 },
    { x: 470, y: 545 }
  ];

  AO.STATE_LABELS = {
    idle: "空闲",
    walking: "移动中",
    working: "工作中",
    reviewing: "评审中",
    meeting: "开会中",
    coffee: "咖啡时间",
    chatting: "交流中",
    blocked: "等待中",
    celebrating: "庆祝中"
  };

  AO.STATE_BADGES = {
    idle: "·",
    walking: "→",
    working: "⚙",
    reviewing: "◉",
    meeting: "▣",
    coffee: "☕",
    chatting: "…",
    blocked: "!",
    celebrating: "★"
  };
})();
