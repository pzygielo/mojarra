<%--

    Copyright (c) 1997, 2018 Oracle and/or its affiliates. All rights reserved.

    This program and the accompanying materials are made available under the
    terms of the Eclipse Public License v. 2.0, which is available at
    http://www.eclipse.org/legal/epl-2.0.

    This Source Code may also be made available under the following Secondary
    Licenses when the conditions for such availability set forth in the
    Eclipse Public License v. 2.0 are satisfied: GNU General Public License,
    version 2 with the GNU Classpath Exception, which is available at
    https://www.gnu.org/software/classpath/license.html.

    SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0

--%>

<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html>
  <head>
    <title>Test form enctype EL feature</title>
    <%@ taglib uri="http://java.sun.com/jsf/core"  prefix="f" %>
    <%@ taglib uri="http://java.sun.com/jsf/html"  prefix="h" %>
  </head>

  <body>
    <h1>Test form enctype EL feature</h1>

<h2>Literal ids with prependId literal</h2>

<f:view>

    <h:outputText value="#{true ? 'multipart/form-data' :
        'application/x-www-form-urlencoded'}" />

    <h:form id="multiPart"
        enctype="#{true ? 'multipart/form-data' : 'application/x-www-form-urlencoded'}">
    </h:form>

    <h:form id="urlEncoded"
        enctype="#{false ? 'multipart/form-data' : 'application/x-www-form-urlencoded'}">
    </h:form>

    <h:form id="stringLiteral" enctype="hi"></h:form>

    <h:form id="elLiteral" enctype="#{'multipart/form-data'}"></h:form>
</f:view>

    <hr>
  </body>
</html>