-- Crear la tabla claimextract
CREATE TABLE IF NOT EXISTS claimextract (
    id INT AUTO_INCREMENT PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    fieldname VARCHAR(255) NOT NULL,
    prompt TEXT NOT NULL,
    example TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_filename (filename)
);

-- Insertar datos de ejemplo
INSERT INTO claimextract (filename, fieldname, prompt, example) VALUES
('contract.pdf', 'contract_number', 'Extract the contract number from this legal document. Look for patterns like "Contract No.", "Agreement No.", or similar identifiers.', 'CTR-2024-001'),
('invoice.pdf', 'total_amount', 'Extract the total amount or final sum from this invoice document. Look for "Total", "Amount Due", or final monetary value.', '$1,250.50'),
('certificate.pdf', 'certificate_id', 'Extract the certificate ID or identification number from this certificate document.', 'CERT-2024-ABC123'),
('letter.pdf', 'date_issued', 'Extract the date when this document was issued or created. Look for date patterns in various formats.', '2024-06-26'),
('agreement.pdf', 'party_names', 'Extract the names of the parties involved in this agreement. Look for "Party A", "Party B", company names, or individual names.', 'Acme Corp, John Smith LLC')
ON DUPLICATE KEY UPDATE
    fieldname = VALUES(fieldname),
    prompt = VALUES(prompt),
    example = VALUES(example); 