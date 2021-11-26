/*
 * Copyright (c) 1997, 2018 Oracle and/or its affiliates. All rights reserved.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0, which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the
 * Eclipse Public License v. 2.0 are satisfied: GNU General Public License,
 * version 2 with the GNU Classpath Exception, which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 */

package com.sun.faces.test.javaee6web.flowreturnfromdepth;

import com.gargoylesoftware.htmlunit.html.HtmlInput;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import com.gargoylesoftware.htmlunit.WebClient;
import com.gargoylesoftware.htmlunit.html.HtmlPage;
import com.sun.faces.test.junit.JsfTest;
import com.sun.faces.test.junit.JsfTestRunner;
import com.sun.faces.test.junit.JsfVersion;
import static org.junit.Assert.assertTrue;
import org.junit.runner.RunWith;

@RunWith(JsfTestRunner.class)
public class Issue2865IT {

    private String webUrl;
    private WebClient webClient;

    @Before
    public void setUp() {
        webUrl = System.getProperty("integration.url");
        webClient = new WebClient();
    }

    @After
    public void tearDown() {
        webClient.close();
    }

    @JsfTest(JsfVersion.JSF_2_2_1)
    @Test
    public void testFacesFlowCallPostback() throws Exception {
        HtmlPage page = webClient.getPage(webUrl);
        assertTrue(page.getBody().asText().indexOf("Return From Depth Test") != -1);

        HtmlInput button = (HtmlInput) page.getElementById("flow1");
        page = button.click();
        button = (HtmlInput) page.getElementById("flow2");
        page = button.click();
        button = (HtmlInput) page.getElementById("exit2");
        page = button.click();
        String pageText = page.asText();
        assertTrue(pageText.contains("Return From Depth Test"));
    }
}