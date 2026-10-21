/**
 * 赛事报名_CommandButton1_Click Macro
 * 窗体名称：赛事报名
 * 第1步生成报名表
 */
function 赛事报名_CommandButton1_Click()
{
    // 获取界面输入参数（ActiveX控件引用方式）
    var 赛事名称 = 赛事报名.TextEdit1.Text;  // 赛事名称文本框
    var 赛事分组 = 赛事报名.TextEdit4.Text;  // 赛事分组文本框
    
    // 验证输入是否为空
    if(赛事名称 == "" || 赛事名称 == null) {
        Application.Alert("请输入赛事名称！");
        return;
    }
    if(赛事分组 == "" || 赛事分组 == null) {
        Application.Alert("请输入赛事分组！");
        return;
    }
    Application.DisplayAlerts = false; 
    // 删除已存在的报名表
    try {
    	Application.Workbooks.Item(1).Worksheets.Item("报名表").Delete();
    } catch(e) {
    	
    }finally {
        Application.DisplayAlerts = true; 
    }
        
    // 创建报名表工作表
    var 报名表 = Application.Workbooks.Item(1).Worksheets.Add();
    报名表.Name = "报名表";
    
    // 设置表头
    报名表.Range("A1").Value2 = "序号";
    报名表.Range("B1").Value2 = "车号";
    报名表.Range("C1").Value2 = "车手";
    报名表.Range("D1").Value2 = "领航员";
    报名表.Range("E1").Value2 = "车型";
    报名表.Range("F1").Value2 = "车队";
    报名表.Range("G1").Value2 = "组级";
    报名表.Range("H1").Value2 = "备注";
    
    // 解析分组字符串，设置分组列头
    var 分组数组 = 赛事分组.split(",");
    var 起始列 = 9; // H列之后从I列开始
    for(var i = 0; i < 分组数组.length; i++) {
        报名表.Cells.Item(1, 起始列 + i).Value2 = 分组数组[i].trim();
    }
    
    // 设置数据区域（假设最多500辆车）
    var 最大车辆数 = 500;
    for(var row = 2; row <= 最大车辆数 + 1; row++) {
        报名表.Cells.Item(row, 1).Value2 = row - 1;  // 序号
        // 车号、车队、车手、领航员留空供填写
        // 分组列留空供打√
    }
    
    // 设置边框和格式
    var 数据区域 = 报名表.Range(报名表.Cells.Item(1, 1), 报名表.Cells.Item(最大车辆数 + 1, 起始列 + 分组数组.length - 1));
    数据区域.Borders.LineStyle = 1;  // 设置边框
    
    // 设置表头加粗
    var 最后一列地址= 报名表.Cells.Item(起始列 + 分组数组.length - 1).Address();
    报名表.Range("A1",最后一列地址).Font.Bold = true;
    报名表.Range("A1",最后一列地址).Interior.Color = 0xCCCCCC;
    
    // 设置列宽
    报名表.Columns.Item(1).ColumnWidth = 5;   // 序号
    报名表.Columns.Item(2).ColumnWidth = 10;  // 车号
    报名表.Columns.Item(3).ColumnWidth = 10;  // 车手
    报名表.Columns.Item(4).ColumnWidth = 10;  // 领航员
    报名表.Columns.Item(5).ColumnWidth = 10;  // 车型
    报名表.Columns.Item(6).ColumnWidth = 20;  // 车队
    报名表.Columns.Item(7).ColumnWidth = 10;  // 组级
    报名表.Columns.Item(8).ColumnWidth = 10;  // 分割列
    for(var i = 0; i < 分组数组.length; i++) {
        报名表.Columns.Item(起始列 + i).ColumnWidth = 8;  // 分组列
    }
    
    // 设置分组列居中
    for(var i = 0; i < 分组数组.length; i++) {
        报名表.Columns.Item(起始列 + i).HorizontalAlignment = -4108;  // xlCenter
    }
    
    // 关闭警告提示，防止每次删除都弹出确认框
    Application.DisplayAlerts = false;
    // 存储赛事信息到隐藏工作表供后续使用
    try {
        Application.Workbooks.Item(1).Worksheets.Item("赛事信息").Delete();
    } catch(e) {}
    finally{
       	Application.DisplayAlerts = true;
    }
    
    var 信息表 = Application.Workbooks.Item(1).Worksheets.Add();
    信息表.Name = "赛事信息";
    信息表.Range("A1").Value2 = "赛事名称";
    信息表.Range("B1").Value2 = 赛事名称;
    信息表.Range("A2").Value2 = "赛事分组";
    信息表.Range("B2").Value2 = 赛事分组;
    信息表.Range("A3").Value2 = "分组数量";
    信息表.Range("B3").Value2 = 分组数组.length;
    信息表.Visible = -1;  // xlSheetVeryHidden
    
    alert("报名表生成完成！请填写参赛车辆信息并在对应分组列打√");
}

/**
 * 赛段成绩_CommandButton1_Click Macro
 * 窗体名称：赛段成绩
 * 第2步生成各赛段工作表、总成绩表、分组成绩表
 */
function 赛段成绩_CommandButton1_Click()
{
    // 1. 获取界面参数 (严格按用户指定方式，无异常捕获)
    var 赛段数量_Str = 赛段成绩.SpinButton1.Value; 
    var 赛段前缀_Str = 赛段成绩.TextEdit2.Value;
    var 时间精度_Str = 赛段成绩.OptionButton1.Value == true ? "0.01" : "0.001"; 
    
    var 赛段数量 = parseInt(赛段数量_Str);
    var 是高精度 = (时间精度_Str == "0.001");
    
    if(赛段数量 <= 0 || 赛段数量 > 100) {
        alert("赛段数量必须在 1 到 100 之间！");
        return;
    }
    
    // 2. 获取基础数据
    var 信息表 = Application.Workbooks.Item(1).Worksheets.Item("赛事信息");
    var 报名表 = Application.Workbooks.Item(1).Worksheets.Item("报名表");
    
    var 赛事分组 = 信息表.Range("B2").Value2;
    var 分组数组 = 赛事分组.split(",");
    var 分组数量 = 分组数组.length;
    
    // 统计车辆数，并清理报名表分组情况
    var 参赛车辆数 = 0;
    var row = 2;
    var 分组起始列号 = 9;
    // 不停往下行寻找，直到连续出现1行空值才视作统计结束
    while(row < 500) { 
        var val = 报名表.Cells.Item(row, 2).Value2; // 检查 B 列 (车号)
        if (val != null && val.toString().trim() != "") {
            // 该车号有效，计数 +1
            参赛车辆数++;
            // --- 分组标记 ---
            for (var i = 0; i < 分组数量; i++) {
                var 当前列号 = 分组起始列号 + i;
                var 单元格对象 = 报名表.Cells.Item(row, 当前列号);
                var 分组值 = 单元格对象.Value2;
                // 判断：只要不是 null 且不是空字符串，就视为参加了该分组
                if (分组值 != null && 分组值.toString().trim() != "") {
                    // 无论原值是什么，统一替换为 "√"
                    单元格对象.Value2 = "√";
                } else {
                    // 如果原本就是空的，保持为空 (或者也可以显式设为 ""，视需求而定)
                }
            }
            row++;
        } else {
            // 车号为空，结束统计
            break;
        }
    }
    
    if(参赛车辆数 == 0) {
        alert("报名表中无车辆信息！");
        return;
    }
    var 最后一行号 = 参赛车辆数 + 1;
    
    // 3. 清理旧表
    var 表名数组 = ["总成绩", "分组成绩"];
    for(var i = 1; i <= 赛段数量; i++) 表名数组.push(赛段前缀_Str + i);
    // 关闭警告提示，防止每次删除都弹出确认框
    Application.DisplayAlerts = false;
    for(var i = 0; i < 表名数组.length; i++) {
        try { 
        	Application.Workbooks.Item(1).Worksheets.Item(表名数组[i]).Delete(); 
        } catch(e) {
       	}finally{
       		Application.DisplayAlerts = true;
       	}
    }
    
    信息表.Range("A4").Value2 = "参赛车辆总数";
    信息表.Range("B4").Value2 = 参赛车辆数;
    信息表.Range("A5").Value2 = "赛段总数";
    信息表.Range("B5").Value2 = 赛段数量_Str;
    信息表.Range("A6").Value2 = "计时精度";
    信息表.Range("B6").Value2 = 时间精度_Str;
    
    // ==================== 生成 SS1-SSN 赛段成绩表 ====================
    var tempObj = 报名表;
    
    // 定义公式生成器 (严格匹配用户提供的公式)
    function GetTimeFormula(cellRef, isMilli) {
        if (!isMilli) {
            // 0.01 精度公式
            return "=TIME(INT(" + cellRef + "/1000000),INT(MOD(" + cellRef + ",1000000)/10000),INT(MOD(" + cellRef + ",10000)/100))+MOD(" + cellRef + ",100)/8640000";
        } else {
            // 0.001 精度公式
            return "=TIME(INT(" + cellRef + "/10000000),INT(MOD(" + cellRef + ",10000000)/100000),INT(MOD(" + cellRef + ",100000)/1000))+MOD(" + cellRef + ",1000)/86400000";
        }
    }
    
    var 时间显示格式 = 是高精度 ? "[hh]:mm:ss.000" : "[hh]:mm:ss.00";
    var 输入区文本格式 = "@"; 
    //RGB(255, 255, 0)  0x是BGR
    var 浅黄色 = 0x00FFFF;
    //RGB(0, 176, 80) 
    var 浅绿色 = 0x50B000;
    //RGB(0, 112, 192)
    var 浅蓝色 = 0xC07000; 
    
    for(var ss = 1; ss <= 赛段数量; ss++) {
        var SS表 = Application.Workbooks.Item(1).Worksheets.Add(null, tempObj, 1);
        tempObj = SS表;
        SS表.Name = 赛段前缀_Str + ss;
        
        // --- 表头设置 ---
        SS表.Range("A1").Value2 = "序号";
        SS表.Range("B1").Value2 = "车号";
        SS表.Range("C1").Value2 = "车手";
        SS表.Range("D1").Value2 = "领航员";
        SS表.Range("E1").Value2 = "车型";
        SS表.Range("F1").Value2 = "车队";
        SS表.Range("G1").Value2 = "组级";
        
        // 输入区 (H, I, J)
        SS表.Range("H1").Value2 = "发车时间输入区";
        SS表.Range("I1").Value2 = "收车时间输入区";
        SS表.Range("J1").Value2 = "罚时输入区";
        SS表.Range("H1").Interior.Color = 浅黄色; 
        SS表.Range("I1").Interior.Color = 浅黄色; 
        SS表.Range("J1").Interior.Color = 浅黄色; 
        
        // 结果时间 (K, L, M)
        SS表.Range("K1").Value2 = "发车时间";
        SS表.Range("L1").Value2 = "收车时间";
        SS表.Range("M1").Value2 = "罚时";
        SS表.Range("K1").Interior.Color = 浅绿色; 
        SS表.Range("L1").Interior.Color = 浅绿色; 
        SS表.Range("M1").Interior.Color = 浅绿色; 
        
        // 计算结果 (N)
        SS表.Range("N1").Value2 = "赛段用时";
        SS表.Range("N1").Interior.Color = 浅蓝色; 
        
        // 赛段名次 (O)
        SS表.Range("O1").Value2 = "赛段名次";
        SS表.Range("O1").Interior.Color = 浅蓝色; 
        
        // --- 填充数据行 ---
        for(var r = 2; r <= 最后一行号; r++) {
            // A-G: 基础信息引用
            SS表.Cells.Item(r, 1).Value2 = r - 1;
            SS表.Cells.Item(r, 2).Formula = "=报名表!B" + r;
            SS表.Cells.Item(r, 3).Formula = "=报名表!C" + r;
            SS表.Cells.Item(r, 4).Formula = "=报名表!D" + r;
            SS表.Cells.Item(r, 5).Formula = "=报名表!E" + r;
            SS表.Cells.Item(r, 6).Formula = "=报名表!F" + r;
            SS表.Cells.Item(r, 7).Formula = "=报名表!G" + r;
            
            // H: 发车时间输入区 (预填基准值 hhmmssxxx)
            SS表.Cells.Item(r, 8).NumberFormat = 输入区文本格式;
            SS表.Cells.Item(r, 8).Value2 = 是高精度 ? "000000000" : "00000000";
            SS表.Cells.Item(r, 8).Interior.Color = 浅黄色; 
            
            // I: 收车时间输入区
            SS表.Cells.Item(r, 9).NumberFormat = 输入区文本格式;
            SS表.Cells.Item(r, 9).Value2 = 是高精度 ? "000000000" : "00000000"; 
            SS表.Cells.Item(r, 9).Interior.Color = 浅黄色; 
                       
            // J: 罚时输入区
            SS表.Cells.Item(r, 10).NumberFormat = 输入区文本格式;
            SS表.Cells.Item(r, 10).Value2 = 是高精度 ? "000000000" : "00000000";
            SS表.Cells.Item(r, 10).Interior.Color = 浅黄色; 
            
            // K: 发车时间 (公式) - 引用 H 列
            var 列H = GetColLetter(8) + r;
            SS表.Cells.Item(r, 11).Formula = GetTimeFormula(列H, 是高精度);
            SS表.Cells.Item(r, 11).NumberFormat = 时间显示格式;
            SS表.Cells.Item(r, 11).Interior.Color = 浅绿色; 
            
            // L: 收车时间 (公式) - 引用 I 列
            var 列I = GetColLetter(9) + r;
            SS表.Cells.Item(r, 12).Formula = GetTimeFormula(列I, 是高精度);
            SS表.Cells.Item(r, 12).NumberFormat = 时间显示格式;
            SS表.Cells.Item(r, 12).Interior.Color = 浅绿色; 
            
            // M: 罚时 (公式) - 引用 J 列
            var 列J = GetColLetter(10) + r;
            SS表.Cells.Item(r, 13).Formula = GetTimeFormula(列J, 是高精度);
            SS表.Cells.Item(r, 13).NumberFormat = 时间显示格式;
            SS表.Cells.Item(r, 13).Interior.Color = 浅绿色; 
            
            // N: 赛段用时
            SS表.Cells.Item(r, 14).Formula = "=L" + r + "-K" + r + "+M" + r;
            SS表.Cells.Item(r, 14).NumberFormat = 时间显示格式;
            SS表.Cells.Item(r, 14).Interior.Color = 浅蓝色; 
            
            // O: 赛段名次
            SS表.Cells.Item(r, 15).Formula = "=RANK.EQ(N"+ r +",$N:$N,1)";
            SS表.Cells.Item(r, 15).NumberFormat = 输入区文本格式;
            SS表.Cells.Item(r, 15).Interior.Color = 浅蓝色; 
        }
        
        // --- 格式设置 ---
        var 结束列号 = 15;
        var 数据区域 = SS表.Range(SS表.Cells.Item(1, 1), SS表.Cells.Item(最后一行号, 结束列号));
        数据区域.Borders.LineStyle = 1;
        数据区域.HorizontalAlignment = -4108; // 水平居中
        
        var 表头地址 = SS表.Cells.Item(1, 结束列号).Address();
        var 表头区域 = SS表.Range("A1", 表头地址);
        表头区域.Font.Bold = true;
        表头区域.Interior.Color = 0xCCCCCC;
        
        // 列宽
        SS表.Columns.Item(1).ColumnWidth = 5;
        SS表.Columns.Item(2).ColumnWidth = 10;
        SS表.Columns.Item(3).ColumnWidth = 10;
        SS表.Columns.Item(4).ColumnWidth = 10;
        SS表.Columns.Item(5).ColumnWidth = 10;
        SS表.Columns.Item(6).ColumnWidth = 20;
        SS表.Columns.Item(7).ColumnWidth = 10;
        SS表.Columns.Item(8).ColumnWidth = 16;
        SS表.Columns.Item(9).ColumnWidth = 16;
        SS表.Columns.Item(10).ColumnWidth = 16;
        SS表.Columns.Item(11).ColumnWidth = 16;
        SS表.Columns.Item(12).ColumnWidth = 16;
        SS表.Columns.Item(13).ColumnWidth = 16;
        SS表.Columns.Item(14).ColumnWidth = 16;
        SS表.Columns.Item(15).ColumnWidth = 10;
    }
    
    // ==================== 生成总成绩表 ====================
    var 总成绩表 = Application.Workbooks.Item(1).Worksheets.Add(null, tempObj, 1);
    tempObj = 总成绩表;
    总成绩表.Name = "总成绩";
    
    总成绩表.Range("A1").Value2 = "序号";
    总成绩表.Range("B1").Value2 = "车号";
    总成绩表.Range("C1").Value2 = "车手";
    总成绩表.Range("D1").Value2 = "领航员";
    总成绩表.Range("E1").Value2 = "车型";
    总成绩表.Range("F1").Value2 = "车队";
    总成绩表.Range("G1").Value2 = "组级";
    
    for(var ss = 1; ss <= 赛段数量; ss++) {
        总成绩表.Cells.Item(1, 7 + ss).Value2 = 赛段前缀_Str + ss;
    }
    
    var 总用时列号 = 7 + 赛段数量 + 1;
    var 总排名列号 = 7 + 赛段数量 + 2;
    总成绩表.Cells.Item(1, 总用时列号).Value2 = "赛段总用时";
    总成绩表.Cells.Item(1, 总排名列号).Value2 = "总名次";
    
    var 起始赛段字母 = GetColLetter(8);
    var 结束赛段字母 = GetColLetter(7 + 赛段数量);
    var 总成绩表总用时列字母 = GetColLetter(总用时列号);
    
    for(var r = 2; r <= 最后一行号; r++) {
        总成绩表.Cells.Item(r, 1).Value2 = r - 1;
        for(var c = 2; c <= 7; c++) {
            总成绩表.Cells.Item(r, c).Formula = "=报名表!" + GetColLetter(c) + r;
        }
        
        for(var sd = 1; sd <= 赛段数量; sd++) {
            var 当前列 = 7 + sd;
            var 临时赛段表名 = 赛段前缀_Str + sd;
            总成绩表.Cells.Item(r, 当前列).Formula = "=XLOOKUP(B"+ r + "," + 临时赛段表名 + "!$B$2:$B$" + 最后一行号 + "," + 临时赛段表名 + "!$N$2:$N$" + 最后一行号 + ")";
            总成绩表.Cells.Item(r, 当前列).NumberFormat = 时间显示格式;
        	总成绩表.Cells.Item(r, 当前列).Interior.Color = 浅绿色;
        }
        
        总成绩表.Cells.Item(r, 总用时列号).Formula = "=SUM(" + 起始赛段字母 + r + ":" + 结束赛段字母 + r + ")";
        总成绩表.Cells.Item(r, 总用时列号).NumberFormat = 时间显示格式;
        总成绩表.Cells.Item(r, 总用时列号).Interior.Color = 浅蓝色;
        
        总成绩表.Cells.Item(r, 总排名列号).Formula = "=RANK.EQ(" + 总成绩表总用时列字母 + r + "," + 总成绩表总用时列字母 + "$2:" + 总成绩表总用时列字母 + "$" + 最后一行号 + ",1)";
    	总成绩表.Cells.Item(r, 总排名列号).Interior.Color = 浅蓝色;
    }
    
    var 总结束地址 = 总成绩表.Cells.Item(1, 总排名列号).Address();
    var 总区域 = 总成绩表.Range(总成绩表.Cells.Item(1, 1), 总成绩表.Cells.Item(最后一行号, 总排名列号));
    总区域.Borders.LineStyle = 1;
    总区域.HorizontalAlignment = -4108;
    总成绩表.Range("A1", 总结束地址).Font.Bold = true;
    总成绩表.Range("A1", 总结束地址).Interior.Color = 0xCCCCCC;
    
    // ==================== 生成分组成绩表 ====================
    var 分组成绩表 = Application.Workbooks.Item(1).Worksheets.Add(null, tempObj, 1);
    tempObj = 分组成绩表;
    分组成绩表.Name = "分组成绩";
    
    分组成绩表.Range("A1").Value2 = "序号";
    分组成绩表.Range("B1").Value2 = "车号";
    分组成绩表.Range("C1").Value2 = "车手";
    分组成绩表.Range("D1").Value2 = "领航员";
    分组成绩表.Range("E1").Value2 = "车型";
    分组成绩表.Range("F1").Value2 = "车队";
    分组成绩表.Range("G1").Value2 = "组级";
    
    分组成绩表.Range("H1").Value2 = "赛段总用时";
    
    var 报名表分组起始列 = 9;
    for(var i = 0; i < 分组数量; i++) {
        分组成绩表.Cells.Item(1, 报名表分组起始列 + i).Value2 = 分组数组[i].trim() + "名次";
        分组成绩表.Cells.Item(1, 报名表分组起始列 + i).ColumnWidth = 18;
    }
    
    for(var r = 2; r <= 最后一行号; r++) {
        分组成绩表.Cells.Item(r, 1).Value2 = r - 1;
        for(var c = 2; c <= 7; c++) {
            分组成绩表.Cells.Item(r, c).Formula = "=报名表!" + GetColLetter(c) + r;
        }
        
        分组成绩表.Cells.Item(r, 8).Formula = "=XLOOKUP(B" + r + ",总成绩!$B$2:$B$" + 最后一行号 + ",总成绩!$" + 总成绩表总用时列字母 + "$2:$" + 总成绩表总用时列字母 + "$" + 最后一行号 + ")";
        分组成绩表.Cells.Item(r, 8).NumberFormat = 时间显示格式;
        分组成绩表.Cells.Item(r, 8).Interior.Color = 浅绿色;
        
        for(var i = 0; i < 分组数量; i++) {
            var 报名分组列 = 报名表分组起始列 + i;
            var 报名分组字母 = GetColLetter(报名分组列);
            
            var 公式 = "=IF(报名表!" + 报名分组字母 + r + "=\"√\",SUMPRODUCT((报名表!" + 报名分组字母 + "$2:" + 报名分组字母 + "$" + 最后一行号 + "=\"√\")*($H$2:$H$" + 最后一行号 + "<$H" + r + ")*($H$2:$H$" + 最后一行号 + ">0))+1,\"/\")";
            
            分组成绩表.Cells.Item(r, 报名分组列).Formula = 公式;
            分组成绩表.Cells.Item(r, 报名分组列).Interior.Color = 浅蓝色;
        }
    }
    
    var 分组结束列 = 报名表分组起始列 + 分组数量 - 1;
    var 分组结束地址 = 分组成绩表.Cells.Item(1, 分组结束列).Address();
    var 分组区域 = 分组成绩表.Range(分组成绩表.Cells.Item(1, 1), 分组成绩表.Cells.Item(最后一行号, 分组结束列));
    分组区域.Borders.LineStyle = 1;
    分组区域.HorizontalAlignment = -4108;
    分组成绩表.Range("A1", 分组结束地址).Font.Bold = true;
    分组成绩表.Range("A1", 分组结束地址).Interior.Color = 0xCCCCCC;
    
    alert("生成完成！\n赛段数量：" + 赛段数量_Str + "\n计时精度：" + 时间精度_Str);
}

// 辅助函数：将列索引转换为字母 (1->A, 26->Z, 27->AA)
function GetColLetter(colNum) {
    if(colNum <= 26) {
        return String.fromCharCode(64 + colNum);
    } else {
        var letter1 = Math.floor((colNum - 1) / 26);
        var letter2 = (colNum - 1) % 26;
        return String.fromCharCode(64 + letter1) + String.fromCharCode(65 + letter2);
    }
}

/**
 * 生成报名表
 */
function CommandButton1_Click()
{
	// 文件打开时自动显示窗体
    try {
        赛事报名.Show();
    } catch(e) {
        // 如果出错则不处理，防止报错干扰
    }
}
/**
 * 生成成绩表
 */
function CommandButton2_Click()
{
	// 文件打开时自动显示窗体
    try {
        赛段成绩.Show();
        //Application.Workbooks.Item(1).Worksheets.Item("启动页").Delete();
    } catch(e) {
        // 如果出错则不处理，防止报错干扰
    }
}
/**
 * 一键删除
 */
function CommandButton3_Click()
{
	var wb = Application.Workbooks.Item(1); // 获取当前工作簿
    var sheetsToDelete = []; // 用于存储需要删除的工作表名称
    
    // 第一步：遍历所有工作表，找出需要删除的
    for (var i = 1; i <= wb.Worksheets.Count; i++) {
        var sheet = wb.Worksheets.Item(i);
        var sheetName = sheet.Name;
        
        // 逻辑：如果不是 "启动页" 页，也不是当前正在运行代码的 Sheet (可选保护)，则加入删除列表
        if (sheetName != "启动页") {
            sheetsToDelete.push(sheetName);
        }
    }
    
    // 第二步：执行删除
    if (sheetsToDelete.length === 0) {
        // alert("没有需要删除的工作表。");
        return;
    }
    
    // 关闭警告提示，防止每次删除都弹出确认框
    var originalAlertState = Application.DisplayAlerts;
    Application.DisplayAlerts = false;
    
    try {
        for (var j = 0; j < sheetsToDelete.length; j++) {
            var nameToDelete = sheetsToDelete[j];
            // 再次检查是否存在，防止意外
            try {
                wb.Worksheets.Item(nameToDelete).Delete();
            } catch(e) {
                // 忽略删除失败的情况（例如该页已被删或受保护）
            }
        }
    } finally {
        // 恢复警告提示
        Application.DisplayAlerts = originalAlertState;
    }
}
