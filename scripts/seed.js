'use strict';

/**
 * 演示数据脚本：首次运行可生成一批带多联系方式的联系人，便于截图与演示。
 * 执行：npm run seed
 * 注意：脚本可重复执行，按姓名判断是否已存在，避免重复插入。
 */

const repo = require('../server/repository');
const { db } = require('../server/db');

const samples = [
  {
    name: '林书远', company: '福州大学 计算机与大数据学院', favorite: true,
    note: '软件工程课程主讲教师，周三下午答疑。',
    methods: [
      { type: 'phone', label: '办公', value: '0591-2286-1234' },
      { type: 'phone', label: '手机', value: '138-0591-0001' },
      { type: 'email', label: '工作', value: 'linsy@fzu.edu.cn' },
      { type: 'wechat', label: '', value: 'linsy_fzu' },
      { type: 'address', label: '办公室', value: '福州市闽侯县大学新区学园路2号 数计楼 405' },
    ],
  },
  {
    name: '陈默', company: '福建星网锐捷通讯股份有限公司', favorite: true,
    note: '实习导师，负责后端接口评审。',
    methods: [
      { type: 'phone', label: '手机', value: '139-5910-2288' },
      { type: 'email', label: '工作', value: 'chenmo@star-net.cn' },
      { type: 'qq', label: '', value: '22881043' },
    ],
  },
  {
    name: '苏晚晴', company: '福州大学 2022级软件工程 3班', favorite: false,
    note: '同组组员，负责前端页面与联调。',
    methods: [
      { type: 'phone', label: '手机', value: '150-6001-7788' },
      { type: 'wechat', label: '', value: 'suwq_2022' },
      { type: 'email', label: '学校', value: '832201234@fzu.edu.cn' },
    ],
  },
  {
    name: '赵启明', company: '厦门建发集团有限公司', favorite: false,
    note: '校友，做企业信息化，可咨询就业方向。',
    methods: [
      { type: 'phone', label: '手机', value: '135-9902-6611' },
      { type: 'email', label: '', value: 'zhaoqm@chinacdc.com' },
    ],
  },
  {
    name: '黄予安', company: '自由职业 · 摄影', favorite: false,
    note: '毕业照拍摄，价格需提前一周预约。',
    methods: [
      { type: 'phone', label: '手机', value: '186-5077-3321' },
      { type: 'wechat', label: '', value: 'huangya_photo' },
      { type: 'other', label: '作品集', value: 'https://huangyu-an.lofter.com' },
    ],
  },
  {
    name: '吴桐', company: '国家电网福州供电公司', favorite: false,
    note: '表姐，节假日回家顺路捎东西。',
    methods: [
      { type: 'phone', label: '手机', value: '137-0501-8899' },
      { type: 'address', label: '家庭', value: '福州市鼓楼区五四路 158 号 3 号楼 602' },
    ],
  },
  {
    name: '郑一鸣', company: '字节跳动 · 基础架构', favorite: true,
    note: '内推联系人，简历投递后微信同步一下进度。',
    methods: [
      { type: 'phone', label: '手机', value: '131-2088-7766' },
      { type: 'email', label: '工作', value: 'zhengyiming@bytedance.com' },
      { type: 'wechat', label: '', value: 'zym_infra' },
      { type: 'other', label: '飞书', value: 'zhengyiming' },
    ],
  },
  {
    name: '何静宜', company: '福州市第一医院 · 护理部', favorite: false,
    note: '体检预约联系人。',
    methods: [
      { type: 'phone', label: '科室', value: '0591-8830-2200' },
      { type: 'email', label: '', value: 'hejy@fzsyy.com' },
    ],
  },
  {
    name: 'Micheal Chen', company: 'NUS · School of Computing', favorite: false,
    note: 'Exchange program coordinator, reply within 2 working days.',
    methods: [
      { type: 'email', label: 'work', value: 'micheal.chen@nus.edu.sg' },
      { type: 'phone', label: 'office', value: '+65 6516 2000' },
      { type: 'address', label: 'office', value: '13 Computing Drive, Singapore 117417' },
    ],
  },
  {
    name: '罗嘉禾', company: '福州大学  ACM 集训队', favorite: false,
    note: '算法队友，周末在机房训练。',
    methods: [
      { type: 'phone', label: '手机', value: '188-5911-2043' },
      { type: 'qq', label: '', value: '1102345678' },
    ],
  },
  {
    name: '许南风', company: '阿里云 · 解决方案架构师', favorite: false,
    note: '云服务器选型与部署可找他确认。',
    methods: [
      { type: 'phone', label: '手机', value: '133-8591-6677' },
      { type: 'email', label: '工作', value: 'xunanfeng@alibaba-inc.com' },
      { type: 'wechat', label: '', value: 'nf_xu_cloud' },
    ],
  },
  {
    name: '王秀兰', company: '', favorite: true,
    note: '家里座机，晚上八点后打比较合适。',
    methods: [
      { type: 'phone', label: '家庭', value: '0593-2288-6677' },
      { type: 'address', label: '老家', value: '宁德市蕉城区蕉城北路 22 号' },
    ],
  },
];

function main() {
  const exists = db.prepare('SELECT 1 FROM contacts WHERE name = ?');
  let inserted = 0;
  let skipped = 0;

  for (const item of samples) {
    if (exists.get(item.name)) {
      skipped += 1;
      continue;
    }
    repo.createContact(item);
    inserted += 1;
  }

  const total = db.prepare('SELECT COUNT(*) AS n FROM contacts').get().n;
  console.log(`演示数据写入完成：新增 ${inserted} 条，跳过已存在 ${skipped} 条，当前共 ${total} 条联系人。`);
  db.close();
}

main();
