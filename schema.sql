-- Create schema
CREATE SCHEMA IF NOT EXISTS leads_dashboard;

-- Set search path
SET search_path TO leads_dashboard;

-- Drop existing tables in correct order (respecting dependencies)
DROP TABLE IF EXISTS lead_tag CASCADE;
DROP TABLE IF EXISTS lead CASCADE;
DROP TABLE IF EXISTS campaign_branch CASCADE;
DROP TABLE IF EXISTS campaign CASCADE;
DROP TABLE IF EXISTS campaign_type CASCADE;
DROP TABLE IF EXISTS sales_person CASCADE;
DROP TABLE IF EXISTS branch CASCADE;
DROP TABLE IF EXISTS customer CASCADE;
DROP TABLE IF EXISTS tag CASCADE;
DROP TABLE IF EXISTS condition CASCADE;
DROP TABLE IF EXISTS lead_status CASCADE;
DROP TABLE IF EXISTS source CASCADE;
DROP TABLE IF EXISTS proposal_status CASCADE;
DROP TABLE IF EXISTS property_type CASCADE;
DROP TABLE IF EXISTS address CASCADE;

-- Create Address table
CREATE TABLE address (
    id SERIAL PRIMARY KEY,
    street VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(50) NOT NULL,
    zip_code VARCHAR(20) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Campaign_Type table
CREATE TABLE campaign_type (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Branch table
CREATE TABLE branch (
    id SERIAL PRIMARY KEY,
    address_id INTEGER REFERENCES address(id),
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Campaign table
CREATE TABLE campaign (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    campaign_type_id INTEGER REFERENCES campaign_type(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Campaign_Branch table (junction table for many-to-many relationship)
CREATE TABLE campaign_branch (
    campaign_id INTEGER REFERENCES campaign(id) ON DELETE CASCADE,
    branch_id INTEGER REFERENCES branch(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (campaign_id, branch_id)
);

-- Create Lead_Status table
CREATE TABLE lead_status (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Sales_Person table
CREATE TABLE sales_person (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    branch_id INTEGER REFERENCES branch(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Source table
CREATE TABLE source (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Proposal_status table
CREATE TABLE proposal_status (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Property_Type table
CREATE TABLE property_type (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Customer table
CREATE TABLE customer (
    id SERIAL PRIMARY KEY,
    address_id INTEGER REFERENCES address(id),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email_address VARCHAR(255),
    phone VARCHAR(20),
    cell_phone VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Tag table
CREATE TABLE tag (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Condition table
CREATE TABLE condition (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Lead table
CREATE TABLE lead (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_date DATE NOT NULL,
    lead_status_id INTEGER REFERENCES lead_status(id),
    last_contacted DATE,
    sales_person_id INTEGER REFERENCES sales_person(id),
    source_id INTEGER REFERENCES source(id),
    proposal_status_id INTEGER REFERENCES proposal_status(id),
    customer_id INTEGER REFERENCES customer(id),
    note TEXT,
    condition_id INTEGER REFERENCES condition(id),
    property_type_id INTEGER REFERENCES property_type(id),
    final_proposal_amount DECIMAL(10,2),
    proposal_tm NUMERIC(10,2),
    inspection_date DATE,
    sold_date DATE,
    recovered BOOLEAN DEFAULT FALSE,
    branch_id INTEGER REFERENCES branch(id),
    campaign_id INTEGER REFERENCES campaign(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Lead_Tag table (junction table for many-to-many relationship)
CREATE TABLE lead_tag (
    lead_id INTEGER REFERENCES lead(id) ON DELETE CASCADE,
    tag_id INTEGER REFERENCES tag(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (lead_id, tag_id)
);

-- Create indexes for better performance
CREATE INDEX idx_lead_status ON lead(lead_status_id);
CREATE INDEX idx_lead_sales_person ON lead(sales_person_id);
CREATE INDEX idx_lead_source ON lead(source_id);
CREATE INDEX idx_lead_proposal_status ON lead(proposal_status_id);
CREATE INDEX idx_lead_customer ON lead(customer_id);
CREATE INDEX idx_lead_condition ON lead(condition_id);
CREATE INDEX idx_lead_property_type ON lead(property_type_id);
CREATE INDEX idx_customer_address ON customer(address_id);
CREATE INDEX idx_lead_tag_lead ON lead_tag(lead_id);
CREATE INDEX idx_lead_tag_tag ON lead_tag(tag_id);
CREATE INDEX idx_branch_address ON branch(address_id);
CREATE INDEX idx_campaign_type ON campaign(campaign_type_id);
CREATE INDEX idx_campaign_branch_campaign ON campaign_branch(campaign_id);
CREATE INDEX idx_campaign_branch_branch ON campaign_branch(branch_id);
CREATE INDEX idx_lead_branch ON lead(branch_id);
CREATE INDEX idx_lead_campaign ON lead(campaign_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_address_updated_at
    BEFORE UPDATE ON address
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaign_type_updated_at
    BEFORE UPDATE ON campaign_type
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_branch_updated_at
    BEFORE UPDATE ON branch
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaign_updated_at
    BEFORE UPDATE ON campaign
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lead_status_updated_at
    BEFORE UPDATE ON lead_status
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sales_person_updated_at
    BEFORE UPDATE ON sales_person
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_source_updated_at
    BEFORE UPDATE ON source
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_proposal_status_updated_at
    BEFORE UPDATE ON proposal_status
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_property_type_updated_at
    BEFORE UPDATE ON property_type
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customer_updated_at
    BEFORE UPDATE ON customer
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tag_updated_at
    BEFORE UPDATE ON tag
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_condition_updated_at
    BEFORE UPDATE ON condition
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lead_updated_at
    BEFORE UPDATE ON lead
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column(); 