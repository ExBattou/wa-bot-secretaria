import * as xlsx from 'xlsx';
import path from 'path';
import fs from 'fs';

const dataPath = process.env.DATA_PATH || path.join(__dirname, '../../data');
const excelFilePath = path.join(dataPath, 'gastos.xlsx');

export const saveExpense = (user_phone: string, expenseData: { date: string, provider: string, amount: number, currency: string, category: string }) => {
    let workbook: xlsx.WorkBook;
    const sheetName = user_phone; // Separar por hoja usando el teléfono

    if (fs.existsSync(excelFilePath)) {
        workbook = xlsx.readFile(excelFilePath);
    } else {
        workbook = xlsx.utils.book_new();
        const initialSheet = xlsx.utils.json_to_sheet([]);
        xlsx.utils.book_append_sheet(workbook, initialSheet, sheetName);
    }

    const worksheet = workbook.Sheets[sheetName];
    const existingData = xlsx.utils.sheet_to_json(worksheet);
    
    existingData.push(expenseData);
    
    const updatedSheet = xlsx.utils.json_to_sheet(existingData);
    workbook.Sheets[sheetName] = updatedSheet;
    
    xlsx.writeFile(workbook, excelFilePath);
    console.log(`✅ Gasto guardado en Excel: $${expenseData.amount} a ${expenseData.provider}`);
};
