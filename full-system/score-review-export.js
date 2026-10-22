(function(root) {
  function appendSheet(XLSX, workbook, sheet) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    const headers = sheet.rows[0] || [];
    worksheet['!cols'] = headers.map(header => header === '车号' || header === '罚时' ? {} : { wch: 12.12 });
    sheet.rows.forEach((row, r) => row.forEach((_, c) => {
      const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
      if (cell) cell.s = { ...(cell.s || {}), alignment: { ...(cell.s && cell.s.alignment || {}), horizontal: 'center' } };
    }));
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }

  root.ScoreReviewExport = { appendSheet };
})(typeof window === 'undefined' ? globalThis : window);
