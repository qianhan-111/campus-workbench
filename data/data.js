window.DB = {
  "semester_start": "2026-08-24",
  "courses": [
    {
      "id": "高数",
      "name": "高等数学A",
      "weekday": 1,
      "start": "08:00",
      "end": "09:40",
      "room": "教三 402",
      "teacher": "张伟",
      "weeks": "1-16",
      "category": "必修",
      "color": "#E6F1FB",
      "note": "教材：同济高数第 8 版"
    },
    {
      "id": "OS",
      "name": "操作系统",
      "weekday": 2,
      "start": "10:00",
      "end": "11:40",
      "room": "计算楼 305",
      "teacher": "李静",
      "weeks": "1-16",
      "category": "必修",
      "color": "#E1F5EE",
      "note": "课件按周更新，课后 24h 内归档"
    },
    {
      "id": "DS",
      "name": "数据结构",
      "weekday": 3,
      "start": "08:00",
      "end": "09:40",
      "room": "教三 201",
      "teacher": "王强",
      "weeks": "1-16",
      "category": "必修",
      "color": "#FAEEDA",
      "note": ""
    },
    {
      "id": "EN",
      "name": "大学英语",
      "weekday": 4,
      "start": "14:00",
      "end": "15:40",
      "room": "外语楼 205",
      "teacher": "Sarah",
      "weeks": "1-16",
      "category": "选修",
      "color": "#FBEAF0",
      "note": ""
    },
    {
      "id": "OSLAB",
      "name": "操作系统实验",
      "weekday": 5,
      "start": "14:00",
      "end": "16:40",
      "room": "计算楼 机房2",
      "teacher": "李静",
      "weeks": "2-16",
      "category": "实验",
      "color": "#EAF3DE",
      "note": "先看实验指导，上机前写预实验"
    },
    {
      "id": "ML",
      "name": "机器学习导论",
      "weekday": 6,
      "start": "09:00",
      "end": "10:40",
      "room": "教三 305",
      "teacher": "赵敏",
      "weeks": "1-12",
      "category": "选修",
      "color": "#EEEDFE",
      "note": ""
    },
    {
      "id": "ENL",
      "name": "大学英语听说",
      "weekday": 6,
      "start": "14:00",
      "end": "15:40",
      "room": "外语楼 301",
      "teacher": "Sarah",
      "weeks": "1-16",
      "category": "选修",
      "color": "#FBEAF0",
      "note": "听力材料每周四晚发群"
    }
  ],
  "ddl": [
    {
      "id": "ddl1",
      "title": "英语小组展示 选题提交",
      "course": "大学英语",
      "due": "2026-08-30T23:59",
      "type": "小组",
      "status": "todo",
      "postponed_count": 0,
      "estimate_minutes": 45,
      "created_at": "2026-08-24"
    },
    {
      "id": "ddl2",
      "title": "ML 课前阅读 Ch1",
      "course": "机器学习导论",
      "due": "2026-08-31T08:00",
      "type": "作业",
      "status": "todo",
      "postponed_count": 0,
      "estimate_minutes": 60,
      "created_at": "2026-08-25"
    },
    {
      "id": "ddl3",
      "title": "高数作业 极限习题 1.1-1.3",
      "course": "高等数学A",
      "due": "2026-09-01T23:59",
      "type": "作业",
      "status": "todo",
      "postponed_count": 0,
      "estimate_minutes": 90,
      "created_at": "2026-08-26"
    },
    {
      "id": "ddl4",
      "title": "操作系统实验报告（实验一）",
      "course": "操作系统",
      "due": "2026-09-03T23:59",
      "type": "实验",
      "status": "todo",
      "postponed_count": 0,
      "estimate_minutes": 120,
      "created_at": "2026-08-27"
    },
    {
      "id": "ddl5",
      "title": "数据结构 第一章读书笔记",
      "course": "数据结构",
      "due": "2026-09-07T23:59",
      "type": "作业",
      "status": "todo",
      "postponed_count": 0,
      "estimate_minutes": 60,
      "created_at": "2026-08-27"
    },
    {
      "id": "ddl6",
      "title": "选课补退选确认",
      "course": "—",
      "due": "2026-08-26T23:59",
      "type": "其他",
      "status": "done",
      "postponed_count": 0,
      "estimate_minutes": 10,
      "created_at": "2026-08-20"
    }
  ],
  "notes": [
    {
      "date": "2026-08-26",
      "course": "操作系统",
      "week": 1,
      "content": "进程 = 程序 + 运行状态。PCB 是进程的\"身份证\"。\n- 三态模型：就绪 / 运行 / 阻塞\n- 上下文切换开销：保存寄存器\n❓没听懂：PCB 里到底存了哪些字段？",
      "flags": [
        "没听懂"
      ]
    },
    {
      "date": "2026-08-24",
      "course": "高等数学A",
      "week": 1,
      "content": "极限定义（ε-δ）重点在\"任意给定 ε，存在 δ\"。\n夹逼准则例题 3 用 sin x / x 的极限。",
      "flags": []
    },
    {
      "date": "2026-08-28",
      "course": "机器学习导论",
      "week": 1,
      "content": "监督学习 vs 无监督学习：有标签 vs 无标签。\n下周课前读 Ch1。",
      "flags": []
    }
  ],
  "qa": {
    "操作系统": [
      {
        "asked_at": "2026-08-26",
        "question": "PCB 里存了哪些字段？",
        "answer_digest": "PID、进程状态、程序计数器、寄存器、内存指针、I/O 状态、记账信息（见第 1 周课件第 12 页）",
        "related_files": [
          "docs/操作系统/第1周-进程与线程.md"
        ]
      }
    ],
    "待问清单": [
      "OS 课件第 10 页：\"时间片轮转\"和\"多级反馈队列\"的区别？"
    ]
  },
  "courseware": [
    {
      "course": "操作系统",
      "filename": "第1周-进程与线程.md",
      "week": 1,
      "added_at": "2026-08-24",
      "path": "docs/操作系统/第1周-进程与线程.md",
      "size": "18 KB"
    },
    {
      "course": "操作系统",
      "filename": "第2周-调度算法.md",
      "week": 2,
      "added_at": "2026-08-28",
      "path": "docs/操作系统/第2周-调度算法.md",
      "size": "21 KB"
    },
    {
      "course": "数据结构",
      "filename": "第1周-绪论与复杂度.md",
      "week": 1,
      "added_at": "2026-08-24",
      "path": "docs/数据结构/第1周-绪论与复杂度.md",
      "size": "15 KB"
    },
    {
      "course": "高等数学A",
      "filename": "第1周-函数与极限.md",
      "week": 1,
      "added_at": "2026-08-24",
      "path": "docs/高等数学A/第1周-函数与极限.md",
      "size": "14 KB"
    }
  ]
};
